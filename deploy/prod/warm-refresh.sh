#!/usr/bin/env bash
# warm-refresh.sh -- refresh reports by interest, in two tiers:
#   weekly:  repos someone saved, or viewed on Holt in the last 30 days;
#   monthly: the rest of the seed list.
# Each tier's reports older than its age (HOLT_REFRESH_WEEKLY_HOURS, 168;
# HOLT_REFRESH_MONTHLY_HOURS, 720) are read again, oldest first; that is
# HOLT_WARM_MAX_AGE_HOURS for the tier's pass (`warm --tier`). It runs daily,
# so the work spreads over the week instead of landing on one day. Every
# report it makes also keeps its evidence ($STATE/evidence), so history
# accumulates. Log: $STATE/logs/warm-refresh.log.
#
# SHIPPED OFF. install.sh writes holt-prod-warm-refresh.service / .timer
# (06:00 UTC daily) but doesn't enable them; switch it on with
#   deploy/prod/install.sh --refresh-on
# and off with --refresh-off. By hand: deploy/prod/warm-refresh.sh.
#
# Cost: the reports go through the job queue at badge priority, so people's
# checks always run first, and each pass stops below HOLT_WARM_MIN_POINTS
# (1500) GitHub points left. A tier left unfinished carries on the next day.
#
# Never overlaps another warm pass (their advisory lock: exit 75, logged as
# skipped). It doesn't hold deploy.sh's lock, which would stall deploys for
# hours; a deploy mid-pass leaves it on the image it started with, as warm.sh.
#
# The timer runs the copy in $STATE/bin (install.sh), with the compose file
# and env.sh of the deployed commit ($STATE/src), like the live stack.
# Rehearsal: HOLT_PROD_PROJECT and HOLT_PROD_HOME as for deploy.sh (README.md).
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

STATE="${HOLT_PROD_HOME:-$HOME/.local/share/holt-prod}"
PROD="$STATE/src/deploy/prod"
LOG="$STATE/logs/warm-refresh.log"
WEEKLY_HOURS="${HOLT_REFRESH_WEEKLY_HOURS:-168}"
MONTHLY_HOURS="${HOLT_REFRESH_MONTHLY_HOURS:-720}"
mkdir -p "$STATE/logs"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }

sha="$(cat "$STATE/current" 2>/dev/null || true)"
[[ -n "$sha" && -f "$PROD/compose.yml" ]] || { log "nothing deployed yet (no $STATE/current or $PROD); skipped"; exit 0; }
# shellcheck source=env.sh
. "$PROD/env.sh"   # PROJECT, load_prod_env

export HOLT_SRC="$STATE/src" HOLT_TAG="$sha" HOLT_PROD_HOME="$STATE" HOLT_PROD_PROJECT="$PROJECT"
load_prod_env >/dev/null   # the GitHub App or GITHUB_TOKENS, for `compose run`
NAME="$PROJECT-warm-refresh"

tier() {   # tier <weekly|monthly> <max age in hours>
    log "refreshing the $1 tier: reports older than $2 hours (${sha:0:7})"
    docker rm -f "$NAME" >/dev/null 2>&1 || true   # a crashed run's leftover
    set +e
    docker compose -p "$PROJECT" -f "$PROD/compose.yml" --env-file "$STATE/.env" \
        run --rm --no-deps --name "$NAME" --label "holt.stack=$PROJECT" \
        -e HOLT_WARM_MAX_AGE_HOURS="$2" \
        server python -m holt_server.warm --tier "$1" 2>&1 \
        | while IFS= read -r line; do log "$line"; done
    local code="${PIPESTATUS[0]}"
    set -e
    case "$code" in
        0)  ;;
        75) log "another warm pass was running; the $1 tier skipped today" ;;
        *)  log "ERROR: the $1 tier exited $code"; return "$code" ;;
    esac
}

tier weekly "$WEEKLY_HOURS"
tier monthly "$MONTHLY_HOURS"
