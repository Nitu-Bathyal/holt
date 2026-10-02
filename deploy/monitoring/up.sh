#!/usr/bin/env bash
# up.sh -- start or update Holt's monitoring stack (compose.yml). Safe to run
# again: every step checks first, and a config that doesn't pass its check
# never replaces the one in use.
#
#   deploy/monitoring/up.sh               start it, or apply changed configs
#   deploy/monitoring/up.sh --status      containers, memory, disk, scrape targets
#   deploy/monitoring/up.sh --test-alert  send a test alert through every channel
#   deploy/monitoring/up.sh --check       check every config; start and change nothing
#   deploy/monitoring/up.sh --down        stop it (the data on /home stays)
#
# What it does:
# 1. Makes $HOLT_MON_HOME (~/.local/share/holt-monitoring, on /home): data/
#    (Prometheus, Grafana, Alertmanager), config/ (rendered) and secrets/.
# 2. Makes Grafana's admin password once (secrets/grafana-admin, chmod 600).
# 3. Makes the `holt_monitor` role in the Holt database, if missing: a
#    member of Postgres's pg_monitor and nothing else, at most 3 connections.
# 4. Renders prometheus.yml and alertmanager.yml, checks them (promtool,
#    amtool), and copies them with the rules, dashboards and probes to config/.
# 5. `compose up -d`, tells a running Prometheus and Alertmanager to read
#    their configs again, waits for Grafana and says how to reach it.
#
# Settings, each read from the environment, then $HOLT_MON_HOME/monitoring.env,
# then ~/.config/holt/secrets.env (KEY=value lines):
#   HOLT_ALERT_EMAIL_TO       where alert emails go; unset = no email
#   HOLT_ALERT_EMAIL_FROM     default "Holt monitoring <alerts@githolt.com>"
#   RESEND_API_KEY            the email provider's key (already in secrets.env)
#   HOLT_ALERT_SMTP_HOST / _USER / _PASSWORD   another SMTP server instead of
#                             Resend's (smtp.resend.com:587, user "resend")
#   HOLT_ALERT_WEBHOOK_URL    also POST every alert here (Alertmanager's JSON)
#   HOLT_WATCHDOG_URL         a healthchecks ping URL, hit every 5 minutes
#                             while monitoring works (README.md)
#   HOLT_GRAFANA_PORT         8320, on 127.0.0.1
#   HOLT_MON_SITE_URL         https://githolt.com
#   HOLT_MON_TARGET           holt-prod: the compose project to watch
# For a trial run beside the real one: HOLT_MON_PROJECT, HOLT_MON_HOME,
# HOLT_MON_NETWORK (README.md, "Trying a change").
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

MON_HOME="${HOLT_MON_HOME:-$HOME/.local/share/holt-monitoring}"
PROJECT="${HOLT_MON_PROJECT:-holt-monitoring}"
SECRETS="${HOLT_SECRETS_FILE:-$HOME/.config/holt/secrets.env}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# setting KEY [default]: the environment, then monitoring.env, then secrets.env.
setting() {
    local key="$1" file val
    if [[ -n "${!key:-}" ]]; then printf '%s' "${!key}"; return; fi
    for file in "$MON_HOME/monitoring.env" "$SECRETS"; do
        [[ -f "$file" ]] || continue
        val="$(sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?$key[[:space:]]*=[[:space:]]*//p" "$file" | tail -1)"
        val="${val%"${val##*[![:space:]]}"}"
        [[ "$val" == \"*\" || "$val" == \'*\' ]] && val="${val:1:${#val}-2}"
        if [[ -n "$val" ]]; then printf '%s' "$val"; return; fi
    done
    printf '%s' "${2:-}"
}

TARGET="$(setting HOLT_MON_TARGET holt-prod)"
NETWORK="$(setting HOLT_MON_NETWORK "${TARGET}_default")"
SITE_URL="$(setting HOLT_MON_SITE_URL https://githolt.com)"; SITE_URL="${SITE_URL%/}"
PORT="$(setting HOLT_GRAFANA_PORT 8320)"
EMAIL_TO="$(setting HOLT_ALERT_EMAIL_TO)"
EMAIL_FROM="$(setting HOLT_ALERT_EMAIL_FROM 'Holt monitoring <alerts@githolt.com>')"
SMTP_HOST="$(setting HOLT_ALERT_SMTP_HOST smtp.resend.com:587)"
SMTP_USER="$(setting HOLT_ALERT_SMTP_USER resend)"
SMTP_PASSWORD="$(setting HOLT_ALERT_SMTP_PASSWORD)"; SMTP_PASSWORD="${SMTP_PASSWORD:-$(setting RESEND_API_KEY)}"
WEBHOOK_URL="$(setting HOLT_ALERT_WEBHOOK_URL)"
WATCHDOG_URL="$(setting HOLT_WATCHDOG_URL)"

export HOLT_MON_HOME="$MON_HOME" HOLT_MON_NETWORK="$NETWORK" HOLT_GRAFANA_PORT="$PORT"
HOLT_MON_UID="$(id -u)"; HOLT_MON_GID="$(id -g)"; export HOLT_MON_UID HOLT_MON_GID
compose() { docker compose -p "$PROJECT" -f "$here/compose.yml" "$@"; }
image_of() { compose config --images | grep -m1 "$1"; }

# render <dir>: every config, as the containers will read it, into <dir>.
# The SMTP password is not among them (secrets/, see compose.yml).
render() {
    local out="$1" on_email="" on_webhook="" on_watchdog=""
    [[ -n "$EMAIL_TO" && -n "$SMTP_PASSWORD" ]] && on_email=1
    [[ -n "$WEBHOOK_URL" ]] && on_webhook=1
    [[ -n "$WATCHDOG_URL" ]] && on_watchdog=1
    mkdir -p "$out/prometheus" "$out/alertmanager" "$out/blackbox" "$out/grafana"
    cp -r "$here/prometheus/rules" "$out/prometheus/rules"
    cp "$here/blackbox/blackbox.yml" "$out/blackbox/"
    cp -r "$here/grafana/provisioning" "$here/grafana/dashboards" "$out/grafana/"
    TARGET="$TARGET" PROJECT="$PROJECT" SITE_URL="$SITE_URL" SMTP_HOST="$SMTP_HOST" \
    SMTP_USER="$SMTP_USER" EMAIL_FROM="$EMAIL_FROM" EMAIL_TO="$EMAIL_TO" \
    ON_EMAIL="$on_email" ON_WEBHOOK="$on_webhook" ON_WATCHDOG="$on_watchdog" \
        python3 "$here/render.py" "$here" "$out"
    # The two URLs can carry a secret (a ping key), so: files, owner-only.
    ( umask 077
      printf '%s' "$WEBHOOK_URL" > "$out/alertmanager/webhook-url"
      printf '%s' "$WATCHDOG_URL" > "$out/alertmanager/watchdog-url" )
}

# check <dir>: promtool and amtool on a rendered config, in throwaway
# containers of the same images the stack runs.
check() {
    local dir="$1" me; me="$(id -u):$(id -g)"
    docker run --rm --user "$me" --entrypoint promtool -v "$dir/prometheus:/etc/prometheus:ro" \
        "$(image_of prom/prometheus)" check config /etc/prometheus/prometheus.yml >/dev/null \
        || die "prometheus.yml or a rule file is not valid (promtool check config)"
    docker run --rm --user "$me" --entrypoint amtool -v "$dir/alertmanager:/etc/alertmanager:ro" \
        "$(image_of prom/alertmanager)" check-config /etc/alertmanager/alertmanager.yml >/dev/null \
        || die "alertmanager.yml is not valid (amtool check-config)"
}

channels() {
    local on=()
    [[ -n "$EMAIL_TO" && -n "$SMTP_PASSWORD" ]] && on+=("email to $EMAIL_TO")
    [[ -n "$WEBHOOK_URL" ]] && on+=("a webhook")
    local IFS=,
    if (( ${#on[@]} )); then echo "${on[*]}" | sed 's/,/, /g'; else echo none; fi
}

# query <promql>: one instant query, asked inside the prometheus container.
query() {
    compose exec -T prometheus wget -qO- \
        "http://localhost:9090/api/v1/query?query=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1")"
}

case "${1:-}" in
    --down)
        compose down
        log "stopped. Data stays in $MON_HOME/data; up.sh starts it again"; exit 0 ;;
    --status)
        compose ps --format 'table {{.Service}}\t{{.Status}}'
        echo; echo "memory:"
        ids="$(compose ps -q)"
        # shellcheck disable=SC2086
        [[ -n "$ids" ]] && docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}' $ids
        echo; echo "disk ($MON_HOME/data):"
        du -sh "$MON_HOME"/data/* 2>/dev/null | sed 's/^/  /'
        echo; echo "scrape targets:"
        query up | python3 -c '
import json, sys
for r in sorted(json.load(sys.stdin)["data"]["result"], key=lambda r: r["metric"]["job"]):
    m = r["metric"]
    print("  %-4s %s (%s)" % ("up" if r["value"][1] == "1" else "DOWN", m["job"], m["instance"]))'
        echo; echo "alerts firing:"
        query 'ALERTS{alertstate="firing",alertname!="Watchdog"}' | python3 -c '
import json, sys
rows = json.load(sys.stdin)["data"]["result"]
for r in rows:
    print("  " + r["metric"]["alertname"])
if not rows:
    print("  none")'
        exit 0 ;;
    --test-alert)
        compose exec -T alertmanager amtool alert add HoltTestAlert severity=warning \
            --annotation='summary="Test alert from up.sh --test-alert"' \
            --annotation='description="Nothing is wrong. This checks that alerts reach you."' \
            --end="$(date -u -d '+5 minutes' +%FT%TZ)" --alertmanager.url=http://localhost:9093
        log "sent. It goes out in about a minute through: $(channels)"; exit 0 ;;
    --check)
        tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
        compose config --quiet || die "compose.yml is not valid"
        python3 "$here/grafana/dashboards.py" --check || die "the dashboards' JSON is behind dashboards.py"
        render "$tmp"
        check "$tmp"
        cp "$here/prometheus/rules.test.yml" "$tmp/prometheus/"
        docker run --rm --user "$(id -u):$(id -g)" --entrypoint promtool -v "$tmp/prometheus:/p:ro" \
            "$(image_of prom/prometheus)" test rules /p/rules.test.yml \
            || die "an alert rule does not behave as rules.test.yml says"
        log "all checks passed (alerts would go through: $(channels))"; exit 0 ;;
    "") ;;
    *) sed -n '2,10p' "$0"; exit 2 ;;
esac

docker network inspect "$NETWORK" >/dev/null 2>&1 \
    || die "no Docker network $NETWORK: deploy Holt first (deploy/prod/deploy.sh)"
if ! compose ps -q grafana 2>/dev/null | grep -q . && ss -ltn | grep -q "127.0.0.1:$PORT "; then
    die "port $PORT is taken: set HOLT_GRAFANA_PORT"
fi

# 1. Directories. Data is on /home and owned by this user; the containers
# run as this user (compose.yml), so nothing here is root's.
mkdir -p "$MON_HOME"/data/{prometheus,grafana,alertmanager} "$MON_HOME/config"
( umask 077; mkdir -p "$MON_HOME/secrets" )
chmod 700 "$MON_HOME/secrets"

# 2. Secrets.
hex() { python3 -c "import secrets;print(secrets.token_hex(24))"; }
make_secret() {
    [[ -s "$MON_HOME/secrets/$1" ]] && return
    ( umask 077; hex > "$MON_HOME/secrets/$1" )
    log "made secrets/$1"
}
make_secret grafana-admin
make_secret db-password
( umask 077; printf '%s' "$SMTP_PASSWORD" > "$MON_HOME/secrets/smtp-password" )

# 3. The database role. The password is set every time, so the file and the
# role always agree.
db="$(docker ps -q --filter "label=com.docker.compose.project=$TARGET" \
        --filter "label=com.docker.compose.service=db" \
        --filter "label=com.docker.compose.oneoff=False" | head -1)"
[[ -n "$db" ]] || die "the $TARGET db container is not running"
psql() { docker exec -i "$db" psql -U holt -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
exists="$(psql -c "SELECT 1 FROM pg_roles WHERE rolname = 'holt_monitor'")"
# On stdin, not the command line, so the password never shows in `ps`.
psql <<SQL
SET client_min_messages = warning;
$( [[ "$exists" == 1 ]] || echo "CREATE ROLE holt_monitor LOGIN CONNECTION LIMIT 3;" )
ALTER ROLE holt_monitor PASSWORD '$(cat "$MON_HOME/secrets/db-password")';
GRANT pg_monitor TO holt_monitor;
GRANT CONNECT ON DATABASE holt TO holt_monitor;
SQL
[[ "$exists" == 1 ]] || log "created the database role holt_monitor (statistics only)"

# 4. Configs: rendered and checked aside, then copied over the ones in use.
# Copied into the same directories, not swapped: a container keeps the
# directory it was started with.
next="$(mktemp -d "$MON_HOME/config.next.XXXXXX")"; trap 'rm -rf "$next"' EXIT
render "$next"
check "$next"
find "$MON_HOME/config" -type f -delete
cp -a "$next/." "$MON_HOME/config/"

# 5. Start, reload, wait. A container that was already running is told to
# read its config again; one that starts now reads it anyway.
running="$(compose ps -q prometheus alertmanager 2>/dev/null | wc -l)"
compose up -d
if [[ "$running" == 2 ]]; then
    compose exec -T prometheus wget -qO- --post-data= http://localhost:9090/-/reload >/dev/null \
        || die "Prometheus did not take the new config: docker compose -p $PROJECT logs prometheus"
    compose exec -T alertmanager wget -qO- --post-data= http://localhost:9093/-/reload >/dev/null \
        || die "Alertmanager did not take the new config: docker compose -p $PROJECT logs alertmanager"
    log "Prometheus and Alertmanager read their configs again"
fi
for _ in $(seq 60); do
    curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 2
done
curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null \
    || die "Grafana is not answering: docker compose -p $PROJECT logs grafana"

log "monitoring is up, watching $TARGET"
cat <<MSG

  Grafana     http://127.0.0.1:$PORT on this machine only. From the laptop:
                ssh -N -L $PORT:127.0.0.1:$PORT $(hostname)    then open http://localhost:$PORT
              user admin, password in $MON_HOME/secrets/grafana-admin
  Alerts go   through: $(channels)
  Watchdog    $( [[ -n "$WATCHDOG_URL" ]] && echo "pinged every 5 minutes" || echo "not set up (HOLT_WATCHDOG_URL)" )
  Check       $0 --status    (targets take a minute to turn up)
MSG
if [[ "$(channels)" == none ]]; then
    log "WARNING: no alert channel is set up, so alerts only show in Grafana. Set HOLT_ALERT_EMAIL_TO (see the top of this script)"
fi
