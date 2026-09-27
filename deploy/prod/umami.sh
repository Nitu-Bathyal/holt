#!/usr/bin/env bash
# umami.sh -- one-time setup of the analytics service (compose service
# `umami`, profile analytics). Safe to run again: every step checks first.
#
#   deploy/prod/umami.sh
#
# 1. Adds UMAMI_DB_PASSWORD, UMAMI_APP_SECRET and COMPOSE_PROFILES=analytics
#    to .env (so every later deploy's `compose up` keeps Umami running).
# 2. Creates the `umami` role and database in the running `db` (the role
#    owns only that database; it can't read Holt's).
# 3. Starts `umami` and waits for it.
# 4. Replaces the default admin password (admin / umami) with a random one,
#    saved to $STATE/umami-admin (chmod 600), and creates the githolt.com
#    site with the fixed id the web app sends (web/src/lib/analytics.ts).
#
# Needs a deployed stack (deploy.sh ran once). The dashboard is then at
# http://127.0.0.1:${HOLT_UMAMI_PORT:-8311} on the server only; from the laptop:
#   ssh -N -L 8311:127.0.0.1:8311 aahil-server   then open http://localhost:8311
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
. "$here/env.sh"   # STATE, PROJECT, load_prod_env
WEBSITE_ID="2c77adc5-9260-4a3d-b240-fa6ffa8e8f10"   # = UMAMI_WEBSITE_ID in web/src/lib/analytics.ts
DOMAIN="${HOLT_UMAMI_DOMAIN:-githolt.com}"

sha="$(cat "$STATE/current" 2>/dev/null || true)"
[[ -n "$sha" ]] || die "nothing deployed yet (no $STATE/current): run deploy.sh first"
export HOLT_SRC="$STATE/src" HOLT_TAG="$sha" HOLT_PROD_HOME="$STATE" HOLT_PROD_PROJECT="$PROJECT"
compose() { docker compose -p "$PROJECT" -f "$here/compose.yml" --env-file "$STATE/.env" "$@"; }
# compose interpolates the whole file, so it needs the same values as a deploy.
load_prod_env

# 1. Secrets, once.
env_file="$STATE/.env"
hex() { python3 -c "import secrets;print(secrets.token_hex(24))"; }
add_env() { grep -q "^$1=" "$env_file" || { printf '%s=%s\n' "$1" "$2" >> "$env_file"; log "added $1 to $env_file"; }; }
umask 077
add_env UMAMI_DB_PASSWORD "$(hex)"
add_env UMAMI_APP_SECRET "$(hex)"
add_env COMPOSE_PROFILES analytics
envval() { sed -n "s/^$1=//p" "$env_file" | tail -1; }
UMAMI_DB_PASSWORD="$(envval UMAMI_DB_PASSWORD)"
port="${HOLT_UMAMI_PORT:-$(envval HOLT_UMAMI_PORT)}"; port="${port:-8311}"

# 2. Role and database, if missing.
db="$(compose ps -q db)"
[[ -n "$db" ]] || die "the $PROJECT db container is not running"
psql() { docker exec -i "$db" psql -U holt -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
if [[ "$(psql -c "SELECT 1 FROM pg_roles WHERE rolname = 'umami'")" != 1 ]]; then
    # On stdin, not the command line, so the password never shows in `ps`.
    psql <<SQL
CREATE ROLE umami LOGIN PASSWORD '$UMAMI_DB_PASSWORD';
SQL
    log "created role umami"
fi
if [[ "$(psql -c "SELECT 1 FROM pg_database WHERE datname = 'umami'")" != 1 ]]; then
    psql -c 'CREATE DATABASE umami OWNER umami'
    log "created database umami"
fi
psql -c 'REVOKE CONNECT ON DATABASE holt, holt_web FROM PUBLIC' >/dev/null

# 3. Start it (its first start runs its own migrations). --no-deps: db is
# already up, and nothing else in the stack is touched.
compose --profile analytics up -d --no-deps umami
cid="$(compose ps -q umami)"
for _ in $(seq 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" == healthy ]] && break
    sleep 3
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" == healthy ]] || die "umami is not healthy: compose logs umami"

# 4. Admin password and the site, through Umami's own API on the local port.
api="http://127.0.0.1:$port/api"
pwfile="$STATE/umami-admin"
login() { curl -fsS -H 'Content-Type: application/json' -d "$(jq -n --arg p "$1" '{username:"admin",password:$p}')" "$api/auth/login" | jq -r .token; }
if token="$(login umami 2>/dev/null)" && [[ -n "$token" && "$token" != null ]]; then
    new="$(hex)"
    curl -fsS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
        -d "$(jq -n --arg c umami --arg n "$new" '{currentPassword:$c,newPassword:$n}')" "$api/me/password" >/dev/null
    printf 'admin\n%s\n' "$new" > "$pwfile"
    log "replaced Umami's default admin password; it is in $pwfile"
fi
[[ -f "$pwfile" ]] || die "the default password no longer works and $pwfile is missing: reset it in the dashboard"
token="$(login "$(sed -n 2p "$pwfile")")"
[[ -n "$token" && "$token" != null ]] || die "could not sign in with the password in $pwfile"
auth=(-H "Authorization: Bearer $token")
# An unknown id answers 200 with `null`, so look at the body.
if [[ "$(curl -fsS "${auth[@]}" "$api/websites/$WEBSITE_ID" | jq -r '.id // empty')" == "$WEBSITE_ID" ]]; then
    log "site $DOMAIN ($WEBSITE_ID) already exists"
else
    curl -fsS "${auth[@]}" -H 'Content-Type: application/json' \
        -d "$(jq -n --arg id "$WEBSITE_ID" --arg d "$DOMAIN" '{id:$id,name:"Holt",domain:$d}')" "$api/websites" >/dev/null
    log "created site $DOMAIN ($WEBSITE_ID)"
fi
log "Umami is up: dashboard on 127.0.0.1:$port (user admin, password in $pwfile)"
