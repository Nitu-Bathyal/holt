#!/usr/bin/env bash
# Run one load-test scenario against STAGING, with the watcher beside it.
#
#   loadtest/run.sh readers            the ramp of readers, on the local edge
#   loadtest/run.sh fresh              a burst of fresh checks (costs GitHub points)
#   loadtest/run.sh mixed              readers, with a burst of checks in the middle
#   loadtest/run.sh readers --public   the same through https://staging.githolt.com
#
# Settings are environment variables (README.md lists them), e.g.
#   STEPS=10,50 STEP_SECONDS=30 loadtest/run.sh readers
#
# Results go to loadtest/results/<time>-<scenario>[-public]/: k6's summary,
# the watcher's samples, the jobs the run started, and report.md, which is
# also printed.
#
# It refuses production, a busy host and a staging that is building, and the
# watcher stops the run if the host's load passes MAX_LOAD or its available
# memory drops under MIN_AVAILABLE_MB (watch.py).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIO="${1:-}"
PUBLIC=0
[[ "${2:-}" == "--public" ]] && PUBLIC=1
case "$SCENARIO" in
    readers|fresh|mixed) ;;
    *) echo "usage: run.sh readers|fresh|mixed [--public]" >&2; exit 2 ;;
esac

SITE_HOST="${SITE_HOST:-staging.githolt.com}"
STACK="${STACK:-stage-holt-new}"                     # staging's Compose project
LOCAL_EDGE="${LOCAL_EDGE:-http://127.0.0.1:9110}"    # staging's edge on this host
MAX_LOAD="${MAX_LOAD:-20}"
MIN_AVAILABLE_MB="${MIN_AVAILABLE_MB:-2048}"
SECRETS="${HOLT_SECRETS_FILE:-$HOME/.config/holt/secrets.env}"
if (( PUBLIC )); then
    export BASE_URL="${BASE_URL:-https://$SITE_HOST}"
else
    export BASE_URL="${BASE_URL:-$LOCAL_EDGE}"
fi
export SITE_HOST

case "$BASE_URL$SITE_HOST" in
    *//githolt.com*|*//www.githolt.com*) echo "run.sh: that is production. Load tests run against staging only." >&2; exit 2 ;;
esac
[[ "$SITE_HOST" == githolt.com || "$SITE_HOST" == www.githolt.com ]] && { echo "run.sh: that is production." >&2; exit 2; }

K6="${K6:-$(command -v k6 || true)}"
[[ -z "$K6" && -x "$HOME/.cache/holt-loadtest/k6" ]] && K6="$HOME/.cache/holt-loadtest/k6"
[[ -n "$K6" ]] || { echo "run.sh: k6 not found. Install it (README.md) or set K6=/path/to/k6." >&2; exit 2; }

# The host must have room before the run starts, with a margin under the limits.
read -r LOAD1 _ < /proc/loadavg
AVAILABLE_MB=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
if awk -v l="$LOAD1" -v m="$MAX_LOAD" 'BEGIN { exit !(l > m / 2) }'; then
    echo "run.sh: the host's load is $LOAD1 already (over half of MAX_LOAD=$MAX_LOAD). Try later." >&2; exit 1
fi
if (( AVAILABLE_MB < MIN_AVAILABLE_MB + 512 )); then
    echo "run.sh: the host has $AVAILABLE_MB MB available (needs $((MIN_AVAILABLE_MB + 512))). Try later." >&2; exit 1
fi

# Through Cloudflare Access: the service token the smoke tests use
# (deploy/staging/preview.sh), read here, handed to k6 only, never printed.
secret() {   # secret KEY: the value of KEY=value in $SECRETS, else empty (as preview.sh reads it)
    [[ -f "$SECRETS" ]] || return 0
    sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?$1[[:space:]]*=[[:space:]]*//p" "$SECRETS" \
        | tail -1 | sed "s/[[:space:]]*\(#.*\)\?\$//; s/^\"\(.*\)\"\$/\1/; s/^'\(.*\)'\$/\1/"
}
if (( PUBLIC )); then
    : "${STAGING_CF_ACCESS_CLIENT_ID:=$(secret STAGING_CF_ACCESS_CLIENT_ID)}"
    : "${STAGING_CF_ACCESS_CLIENT_SECRET:=$(secret STAGING_CF_ACCESS_CLIENT_SECRET)}"
    export STAGING_CF_ACCESS_CLIENT_ID STAGING_CF_ACCESS_CLIENT_SECRET
fi

OUT="$HERE/results/$(date -u +%Y%m%dT%H%M%SZ)-$SCENARIO$( (( PUBLIC )) && echo -public || true)"
mkdir -p "$OUT"
export SUMMARY_FILE="$OUT/summary.json"

DB="$STACK-db-1"
have_db() { docker inspect "$DB" >/dev/null 2>&1; }

# GitHub points staging's tokens have left, added up (asking is free). The
# difference across a run is what staging spent in that time.
points_left() {
    local server
    server="$(docker ps --filter "label=com.docker.compose.project=$STACK" --filter "label=com.docker.compose.service=server" --format '{{.Names}}' 2>/dev/null | head -n 1)"
    [[ -n "$server" ]] || return 0
    docker exec -i "$server" python - 2>/dev/null <<'PY' || true
import httpx
from holt_server.github import RATE_LIMIT, build_pool
from holt_server.settings import get_settings

http = httpx.Client()
pool = build_pool(get_settings(), http)
total = 0
for index in range(len(pool)):
    try:
        data = pool.transport(http, index=index).query(RATE_LIMIT, timeout=5)
        total += int((data.get("rateLimit") or {}).get("remaining") or 0)
    except Exception:
        pass
print(total)
PY
}

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
POINTS_BEFORE=""
[[ "$SCENARIO" != readers ]] && POINTS_BEFORE="$(points_left)"

echo "run.sh: $SCENARIO against $BASE_URL; results in $OUT"
"$K6" run --quiet "$HERE/$SCENARIO.js" > "$OUT/k6.log" 2>&1 &
K6_PID=$!
python3 "$HERE/watch.py" --out "$OUT/samples.jsonl" --stack "$STACK" --stop-pid "$K6_PID" \
    --max-load "$MAX_LOAD" --min-available-mb "$MIN_AVAILABLE_MB" --build-url "$LOCAL_EDGE/__build" 2> "$OUT/watch.log" &
WATCH_PID=$!
trap 'kill -INT "$K6_PID" 2>/dev/null || true; kill "$WATCH_PID" 2>/dev/null || true' INT TERM

STATUS=0
wait "$K6_PID" || STATUS=$?
kill "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true
trap - INT TERM
cat "$OUT/watch.log" >&2

# The jobs this run started: how long each waited in the queue and ran.
if have_db; then
    docker exec "$DB" psql -U holt -d holt -At -F $'\t' -c "
        select kind, coalesce(repo, ''), status,
               coalesce(round(extract(epoch from started_at - created_at)::numeric, 1)::text, ''),
               coalesce(round(extract(epoch from finished_at - started_at)::numeric, 1)::text, '')
        from jobs where created_at >= '$STARTED' order by created_at" > "$OUT/jobs.tsv" 2>/dev/null || true
fi
if [[ -n "$POINTS_BEFORE" ]]; then
    POINTS_AFTER="$(points_left)"
    [[ -n "$POINTS_AFTER" ]] && echo "$POINTS_BEFORE $POINTS_AFTER" > "$OUT/points.txt"
fi

python3 "$HERE/report.py" "$OUT" | tee "$OUT/report.md"
(( STATUS == 0 )) || echo "run.sh: k6 ended with status $STATUS (see $OUT/k6.log)" >&2
exit "$STATUS"
