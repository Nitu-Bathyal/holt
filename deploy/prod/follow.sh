#!/usr/bin/env bash
# follow.sh -- put origin/main on https://githolt.com once it has passed CI
# and staging. The systemd --user timer from install-follow.sh runs one tick
# every 2 minutes.
#
#   follow.sh                    one tick (what the timer runs)
#   follow.sh --status           what it is doing, and why
#   follow.sh --pause [reason]   stop deploying (the timer keeps ticking, and does nothing)
#   follow.sh --resume           start again
#   follow.sh --retry            forget which commits failed, so the next tick may try them again
#
# One tick: fetch origin/main. When it differs from the live commit
# ($STATE/current), deploy it only if
#   1. CI is green on that exact commit: GitHub has at least one check run
#      for it, and every check run and every workflow run is completed with
#      success or skipped (anything pending waits; anything else is red), and
#   2. staging is live on that same commit (live.main.sha on staging's
#      /__build), which also means it built and started there.
# Then run deploy.sh <sha> (build, migrate, swap, health check, roll back on
# failure), taken from that commit, and, when src/holt/engine_version.py
# changed between the old and the new commit, restart the stale-only warm
# pass (warm.sh --stale-only).
#
# A commit whose deploy fails is recorded and never tried again by the
# timer: production stays on the last good commit until main moves on
# (or --retry). A deploy that could not start because the box was busy or
# another deploy held the lock (deploy.sh exit 75) is not a failure; the
# next tick tries again.
#
# Paused while $STATE/AUTODEPLOY_PAUSED exists. It pauses itself when it sees
# production rolled back by hand to an older commit, so it doesn't undo it.
#
# Status: $STATE/autodeploy.json and the `autodeploy` key on /__build:
#   {state, sha, at, message}; state is one of up_to_date, waiting, blocked,
#   deploying, deployed, failed, held, paused, busy, error.
# Logs: $STATE/logs/follow.log (what changed, one line each), and
# autodeploy-<stamp>-<short>.log per deploy (last 20), beside deploy.sh's.
#
# Rehearsal (README.md): HOLT_PROD_PROJECT, HOLT_PROD_HOME and HOLT_PROD_PORT
# as for deploy.sh, plus HOLT_FOLLOW_REMOTE (a fake origin), HOLT_FOLLOW_GH
# (a stand-in for gh) and HOLT_FOLLOW_STAGING_URL.
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

STATE="${HOLT_PROD_HOME:-$HOME/.local/share/holt-prod}"
PROJECT="${HOLT_PROD_PROJECT:-holt-prod}"
REPO="${HOLT_REPO:-holt-oss/holt}"
REMOTE="${HOLT_FOLLOW_REMOTE:-https://github.com/$REPO.git}"
GH="${HOLT_FOLLOW_GH:-gh}"
STAGING_URL="${HOLT_FOLLOW_STAGING_URL:-http://127.0.0.1:9110/__build}"
FSRC="$STATE/follow/src"        # clone at the commit being deployed; its deploy.sh runs
PAUSE="$STATE/AUTODEPLOY_PAUSED"
FAILED="$STATE/follow/failed"   # "<sha> <at> <message>" per failed deploy
LAST_LIVE="$STATE/follow/last-live"
STATUS="$STATE/autodeploy.json"
FLOG="$STATE/logs/follow.log"
ENGINE_FILE=src/holt/engine_version.py

mkdir -p "$STATE/logs" "$STATE/build" "$STATE/follow"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# status <state> <sha> <message>: the state file, /__build, and one log line
# whenever the state or the message changes (so the log isn't a line per tick).
status() {
    local prev=""
    [[ -f "$STATUS" ]] && prev="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1],encoding="utf-8")); print(d.get("state") or "", d.get("sha") or "", d.get("message") or "")' "$STATUS" 2>/dev/null || true)"
    ST="$1" SHA="$2" MSG="$3" STATUS="$STATUS" BUILD="$STATE/build/build.json" python3 - <<'PY'
import json, os, datetime
env = os.environ
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
auto = {"state": env["ST"], "sha": env["SHA"] or None, "at": now, "message": env["MSG"]}
def put(path, doc):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2); f.write("\n")
    os.replace(tmp, path)
put(env["STATUS"], auto)
try:
    with open(env["BUILD"], encoding="utf-8") as f:
        doc = json.load(f)
except (FileNotFoundError, ValueError):
    doc = {"site": "https://githolt.com", "live": None, "last_attempt": None}
doc["autodeploy"] = auto
put(env["BUILD"], doc)
PY
    log "$1: $3"
    [[ "$prev" == "$1 $2 $3" ]] || printf '%s %s %s: %s\n' "$(date -u +%FT%TZ)" "${2:0:7}" "$1" "$3" >> "$FLOG"
    tail -n 2000 "$FLOG" > "$FLOG.tmp" && mv "$FLOG.tmp" "$FLOG"
}

pause_reason() { local r; r="$(cat "$PAUSE" 2>/dev/null || true)"; echo "${r:-paused by hand}"; }

# --- commands ----------------------------------------------------------------
case "${1:-}" in
    --pause)
        shift; printf '%s\n' "$*" > "$PAUSE"
        status paused "$(cat "$STATE/current" 2>/dev/null || true)" "$(pause_reason); follow.sh --resume to follow main again"
        exit 0 ;;
    --resume)
        rm -f "$PAUSE"
        # Take the live commit as the new baseline, so a rollback made while
        # paused doesn't pause it again straight away.
        cp "$STATE/current" "$LAST_LIVE" 2>/dev/null || true
        status waiting "$(cat "$STATE/current" 2>/dev/null || true)" "resumed; the next tick checks origin/main"
        exit 0 ;;
    --retry)
        rm -f "$FAILED"; log "forgot the failed commits; the next tick may try them again"; exit 0 ;;
    --status)
        cat "$STATUS" 2>/dev/null || echo "no status yet"
        [[ -f "$PAUSE" ]] && echo "PAUSED: $(pause_reason)"
        [[ -s "$FAILED" ]] && { echo "failed, not retried:"; sed 's/^/  /' "$FAILED"; }
        echo "recent:"; tail -n 10 "$FLOG" 2>/dev/null | sed 's/^/  /'
        exit 0 ;;
    "") ;;
    *) echo "usage: follow.sh [--status | --pause [reason] | --resume | --retry]" >&2; exit 2 ;;
esac

exec 8>"$STATE/follow.lock"
if ! flock -n 8; then log "another tick is running; skipping"; exit 0; fi

current="$(cat "$STATE/current" 2>/dev/null || true)"
live="${current:0:7}"; live="${live:-nothing yet}"

if [[ -f "$PAUSE" ]]; then
    status paused "$current" "$(pause_reason); follow.sh --resume to follow main again"; exit 0
fi

# --- origin/main ---------------------------------------------------------------
if [[ ! -d "$FSRC/.git" ]]; then
    log "cloning $REMOTE into $FSRC"
    git clone -q "$REMOTE" "$FSRC" || { status error "" "couldn't clone $REMOTE"; exit 1; }
fi
git -C "$FSRC" remote set-url origin "$REMOTE"
if ! git -C "$FSRC" fetch -q --prune origin '+refs/heads/main:refs/remotes/origin/main'; then
    status error "" "couldn't fetch origin/main; trying again next tick"; exit 1
fi
sha="$(git -C "$FSRC" rev-parse refs/remotes/origin/main)"
short="${sha:0:7}"
is_ancestor() { git -C "$FSRC" merge-base --is-ancestor "$1" "$2" 2>/dev/null; }

# Someone deployed an older commit by hand (a rollback): pause, or the next
# tick would put main straight back.
last_live="$(cat "$LAST_LIVE" 2>/dev/null || true)"
if [[ -n "$current" && -n "$last_live" && "$current" != "$last_live" ]] && is_ancestor "$current" "$last_live"; then
    echo "production was rolled back by hand from ${last_live:0:7} to ${current:0:7}" > "$PAUSE"
    echo "$current" > "$LAST_LIVE"
    status paused "$current" "$(pause_reason); follow.sh --resume to follow main again"; exit 0
fi
[[ -n "$current" ]] && echo "$current" > "$LAST_LIVE"

if [[ "$sha" == "$current" ]]; then
    status up_to_date "$sha" "$short is live; it is origin/main"; exit 0
fi

if [[ -f "$FAILED" ]] && grep -q "^$sha " "$FAILED"; then
    status held "$sha" "$short failed to deploy ($(grep "^$sha " "$FAILED" | tail -1 | cut -d' ' -f3-)); not trying it again. Production stays on $live until main moves on (follow.sh --retry to try it again)"
    exit 0
fi

# --- gate 1: CI on that exact commit ---------------------------------------------
# Prints "green", "pending <what>", "red <what>" or "error <what>".
ci_state() {
    local runs wf
    runs="$("$GH" api --paginate "repos/$REPO/commits/$1/check-runs?per_page=100" \
              --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv' 2>&1)" \
        || { echo "error couldn't read check runs: ${runs:0:200}"; return; }
    wf="$("$GH" api --paginate "repos/$REPO/actions/runs?head_sha=$1&per_page=100" \
              --jq '.workflow_runs[] | [.name, .status, (.conclusion // "")] | @tsv' 2>&1)" \
        || { echo "error couldn't read workflow runs: ${wf:0:200}"; return; }
    printf '%s\n%s\n' "$runs" "$wf" | awk -F'\t' '
        NF < 2 { next }
        { n++ }
        $2 != "completed" { pend = pend (pend ? ", " : "") $1 ; next }
        $3 != "success" && $3 != "skipped" { red = red (red ? ", " : "") $1 " (" $3 ")" }
        END {
            if (red)       print "red " red
            else if (pend) print "pending " pend
            else if (!n)   print "pending no CI results yet"
            else           print "green"
        }'
}
ci="$(ci_state "$sha")"
case "$ci" in
    green) ;;
    red*)     status blocked "$sha" "CI failed on $short: ${ci#red }; waiting for a fixed commit on main"; exit 0 ;;
    pending*) status waiting "$sha" "CI is still running on $short: ${ci#pending }"; exit 0 ;;
    *)        status error "$sha" "${ci#error }; trying again next tick"; exit 0 ;;
esac

# --- gate 2: staging is live on the same commit ------------------------------------
staging="$(curl -fsS --max-time 10 "$STAGING_URL" 2>/dev/null \
    | python3 -c 'import json,sys; print(((json.load(sys.stdin).get("live") or {}).get("main") or {}).get("sha") or "")' 2>/dev/null || true)"
if [[ "$staging" != "$sha" ]]; then
    on="${staging:0:7}"; on="${on:-nothing: its /__build did not answer}"
    status waiting "$sha" "CI is green on $short; staging isn't live on it yet (staging is on $on)"
    exit 0
fi

# --- deploy --------------------------------------------------------------------------
if ! flock -n "$STATE/lock" true; then
    status busy "$sha" "another deploy holds the lock; trying again next tick"; exit 0
fi
git -C "$FSRC" checkout -q -f --detach "$sha"
alog="$STATE/logs/autodeploy-$(date -u +%Y%m%dT%H%M%SZ)-$short.log"
status deploying "$sha" "CI and staging are green on $short; deploying (log: $alog)"
# Recorded before it runs: a deploy killed half-way counts as failed too.
echo "$sha $(date -u +%FT%TZ) did not finish" >> "$FAILED"
set +e
"$FSRC/deploy/prod/deploy.sh" "$sha" >"$alog" 2>&1
rc=$?
set -e
ls -1t "$STATE"/logs/autodeploy-*.log 2>/dev/null | tail -n +21 | xargs -r rm -f
grep -v "^$sha " "$FAILED" > "$FAILED.tmp" || true; mv "$FAILED.tmp" "$FAILED"

if (( rc == 75 )); then
    status busy "$sha" "deploy didn't start: $(grep -m1 'ERROR:' "$alog" | sed 's/^.*ERROR: //'); trying again next tick"
    exit 0
fi
if (( rc != 0 )) || [[ "$(cat "$STATE/current" 2>/dev/null)" != "$sha" ]]; then
    why="$(grep 'ERROR:' "$alog" | tail -1 | sed 's/^.*ERROR: //')"
    why="${why:-deploy.sh exited $rc}"
    echo "$sha $(date -u +%FT%TZ) $why" >> "$FAILED"
    now_live="$(cat "$STATE/current" 2>/dev/null || true)"
    # deploy.sh can fail after the swap (a rejected edge.conf leaves the new
    # release live); then the live commit moved and the follower is on it.
    [[ -n "$now_live" ]] && echo "$now_live" > "$LAST_LIVE"
    live="${now_live:0:7}"; live="${live:-nothing yet}"
    status failed "$sha" "$short failed to deploy: $why. Live: $live. Not retrying $short (log: $alog)"
    exit 1
fi
echo "$sha" > "$LAST_LIVE"

# --- warm the stale reports after an engine change -------------------------------------
warm=""
# Not after a first deploy: nothing is stale, and the full pass is warm.sh by hand.
if [[ -n "$current" ]] && ! git -C "$FSRC" diff --quiet "$current" "$sha" -- "$ENGINE_FILE" 2>/dev/null; then
    if docker ps -q --filter "name=^$PROJECT-warm$" | grep -q .; then
        log "stopping the running warm pass"
        docker stop "$PROJECT-warm" >/dev/null 2>&1 || true
    fi
    if "$FSRC/deploy/prod/warm.sh" --stale-only >>"$alog" 2>&1; then
        warm="; the engine changed, so the stale-only warm pass started"
    else
        warm="; the engine changed, but the stale-only warm pass didn't start (see $alog)"
    fi
fi
status deployed "$sha" "$short is live (was $live)$warm"
