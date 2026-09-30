#!/usr/bin/env bash
# env.sh -- the production stack's environment, shared by deploy.sh and
# warm.sh (source it, then call load_prod_env). Not a script to run.
#
# Sets STATE, PROJECT, SECRETS and, from ~/.config/holt/secrets.env
# (optional, user-managed, KEY=value lines):
#   GITHUB_OAUTH_ID / GITHUB_OAUTH_SECRET  -> AUTH_GITHUB_ID / AUTH_GITHUB_SECRET
#   GOOGLE_OAUTH_ID / GOOGLE_OAUTH_SECRET  -> AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
#   OPENROUTER_API_KEY, GITHUB_TOKENS      -> the same names
#   GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID,
#   GITHUB_APP_PRIVATE_KEY_FILE            -> the same names (the GitHub App)
#   CONTACT_EMAIL / CONTACT_CITY           -> NEXT_PUBLIC_CONTACT_EMAIL / _CITY
# and makes $STATE/evidence (HOLT_EVIDENCE_GID) for the server's snapshots.
# Exported, so they win over .env for compose. An unset key stays empty and
# the feature stays off (sign-in hidden, AI reports answer needs_key). The
# one thing every run needs is a way to read GitHub: the GitHub App, else
# GITHUB_TOKENS from the secrets file, else `gh auth token`, else stop,
# because the server would start with no API budget ("points left 0") and a
# warm pass would end at once.

STATE="${HOLT_PROD_HOME:-$HOME/.local/share/holt-prod}"
SECRETS="${HOLT_SECRETS_FILE:-$HOME/.config/holt/secrets.env}"
# HOLT_PROD_PROJECT: only for a rehearsal on a dev port (README.md); the
# builder, the label and the image names follow it, so the rehearsal and the
# real stack never share anything.
PROJECT="${HOLT_PROD_PROJECT:-holt-prod}"

if ! declare -F log >/dev/null; then log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }; fi
if ! declare -F die >/dev/null; then die() { log "ERROR: $*"; exit 1; }; fi

load_prod_env() {
    if [[ -f "$SECRETS" ]]; then
        local line key val
        while IFS= read -r line || [[ -n "$line" ]]; do
            line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"
            [[ "$line" == *=* ]] || continue
            key="${line%%=*}"; val="${line#*=}"
            key="${key#export }"; key="${key%"${key##*[![:space:]]}"}"
            val="${val#"${val%%[![:space:]]*}"}"; val="${val%"${val##*[![:space:]]}"}"
            [[ "$val" == \"*\" || "$val" == \'*\' ]] && val="${val:1:${#val}-2}"
            [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
            export "$key=$val"
        done < "$SECRETS"
        log "using secrets from $SECRETS"
    fi
    export AUTH_GITHUB_ID="${AUTH_GITHUB_ID:-${GITHUB_OAUTH_ID:-}}"
    export AUTH_GITHUB_SECRET="${AUTH_GITHUB_SECRET:-${GITHUB_OAUTH_SECRET:-}}"
    export AUTH_GOOGLE_ID="${AUTH_GOOGLE_ID:-${GOOGLE_OAUTH_ID:-}}"
    export AUTH_GOOGLE_SECRET="${AUTH_GOOGLE_SECRET:-${GOOGLE_OAUTH_SECRET:-}}"
    export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
    export GITHUB_APP_ID="${GITHUB_APP_ID:-}" GITHUB_APP_INSTALLATION_ID="${GITHUB_APP_INSTALLATION_ID:-}"
    export GITHUB_APP_PRIVATE_KEY_FILE="${GITHUB_APP_PRIVATE_KEY_FILE:-}"
    export HOLT_GITHUB_APP_KEY_GID=""
    if [[ -n "$GITHUB_APP_ID$GITHUB_APP_INSTALLATION_ID$GITHUB_APP_PRIVATE_KEY_FILE" ]]; then
        [[ -n "$GITHUB_APP_ID" && -n "$GITHUB_APP_INSTALLATION_ID" && -n "$GITHUB_APP_PRIVATE_KEY_FILE" ]] \
            || die "the GitHub App is only partly set up in $SECRETS: set GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY_FILE, or none of them"
        [[ -f "$GITHUB_APP_PRIVATE_KEY_FILE" ]] || die "GITHUB_APP_PRIVATE_KEY_FILE: no file at $GITHUB_APP_PRIVATE_KEY_FILE"
        # The server's user reads the key through its group (compose.yml, group_add).
        HOLT_GITHUB_APP_KEY_GID="$(stat -c %g "$GITHUB_APP_PRIVATE_KEY_FILE")"
        export GITHUB_TOKENS=""   # not used while the app is set up
        log "GitHub: reading as the GitHub App (app $GITHUB_APP_ID)"
    else
        if [[ -z "${GITHUB_TOKENS:-}" ]]; then
            GITHUB_TOKENS="$(gh auth token 2>/dev/null || true)"
            [[ -n "$GITHUB_TOKENS" ]] && log "GITHUB_TOKENS: using gh auth token (no secrets file entry)"
        fi
        export GITHUB_TOKENS
        [[ -n "$GITHUB_TOKENS" ]] || die "no GitHub token: put GITHUB_TOKENS in $SECRETS or run gh auth login"
    fi
    # Evidence snapshots (server/holt_server/evidence_store.py): $STATE/evidence
    # on /home, bind-mounted into the server (compose.yml). Made here, before
    # compose, or Docker would create it as root. Group-writable and setgid;
    # the server's user (uid 10001) writes through the directory's group.
    local evidence="$STATE/evidence"
    mkdir -p "$evidence"
    chmod 2775 "$evidence" 2>/dev/null || log "WARNING: can't make $evidence group-writable; the server won't keep evidence"
    HOLT_EVIDENCE_GID="$(stat -c %g "$evidence")"
    # Compose refuses a group twice; the key's group already covers it (a
    # leftover 65534, nogroup, stands in).
    [[ "$HOLT_EVIDENCE_GID" == "${HOLT_GITHUB_APP_KEY_GID:-10001}" ]] && HOLT_EVIDENCE_GID=""
    export HOLT_EVIDENCE_GID
    export NEXT_PUBLIC_CONTACT_EMAIL="${NEXT_PUBLIC_CONTACT_EMAIL:-${CONTACT_EMAIL:-}}"
    export NEXT_PUBLIC_CONTACT_CITY="${NEXT_PUBLIC_CONTACT_CITY:-${CONTACT_CITY:-}}"
}
