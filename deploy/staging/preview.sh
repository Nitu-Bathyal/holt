#!/usr/bin/env bash
# preview.sh -- keep the staging site on the latest preview.
# The site is https://$STAGING_HOST (default staging.githolt.com).
#
# One run: fetch origin; if main, any open PR labelled `staging`, or any
# branch in deploy/staging/extra-branches moved, build a preview commit
# (origin/main merged with each of them, skipping ones that conflict),
# rebuild the images and restart only the stage-holt-new stack. Then run the
# e2e smoke suite once (result on /__build) and prune this stack's dangling
# images and its own build cache.
#
# The systemd --user timer from install.sh runs it every 3 minutes.
# By hand:   preview.sh            (no-op when nothing changed)
#            FORCE=1 preview.sh    (rebuild anyway, and skip the load check)
#
# STAGING_HOST is the one host setting: the web app's site host, HOLT_WEB_URL
# and AUTH_URL (compose.yml), "site" on /__build and the smoke tests' BASE_URL
# all come from it. It lives in deploy/staging/.env (make-env.sh writes it);
# an exported STAGING_HOST wins for that run.
#
# Serialised with flock: a run that finds another in progress exits.
# Waits for the 1-minute load < 6 and MemAvailable > 3 GB before building.
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

STATE="${HOLT_STAGE_HOME:-$HOME/.local/share/holt-staging}"
SRC="$STATE/src"                                   # dedicated clone, detached at the preview
REPO="${HOLT_REPO:-holt-oss/holt}"
LOCAL_REPO="${HOLT_LOCAL_REPO:-$HOME/projects/holt}"  # for extra branches not pushed yet
PROJECT=stage-holt-new
LABEL="holt.stage=holt-new"
BUILDER=holt-stage
MAX_LOAD="${HOLT_STAGE_MAX_LOAD:-6}"
MIN_AVAIL_MB="${HOLT_STAGE_MIN_AVAIL_MB:-3072}"
MAX_WAIT="${HOLT_STAGE_MAX_WAIT:-1800}"            # seconds to wait for room, then retry next tick
DEPLOY="$SRC/deploy/staging"
DEFAULT_HOST=staging.githolt.com
FORCE="${FORCE:-0}"

mkdir -p "$STATE/logs"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

exec 9>"$STATE/lock"
if ! flock -n 9; then log "another run is in progress; skipping"; exit 0; fi

RUN="$(mktemp -d "$STATE/run.XXXXXX")"
trap 'rm -rf "$RUN"' EXIT
: > "$RUN/included.tsv"   # kind  name  branch  sha  title  url
: > "$RUN/skipped.tsv"    # kind  name  branch  sha  title  url  reason

# --- clone ------------------------------------------------------------------
if [[ ! -d "$SRC/.git" ]]; then
    log "cloning $REPO into $SRC"
    git clone -q "https://github.com/$REPO.git" "$SRC"
    git -C "$SRC" config user.name "holt-staging"
    git -C "$SRC" config user.email "holt-staging@localhost"
fi
cd "$SRC"

# --- the host ---------------------------------------------------------------
if [[ -z "${STAGING_HOST:-}" && -f "$DEPLOY/.env" ]]; then
    STAGING_HOST="$(sed -n 's/^STAGING_HOST=//p' "$DEPLOY/.env" | tail -1)"
fi
STAGING_HOST="${STAGING_HOST:-$DEFAULT_HOST}"
if [[ ! "$STAGING_HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
    log "STAGING_HOST must be a bare host name like $DEFAULT_HOST, not '$STAGING_HOST'"; exit 1
fi
if [[ "$STAGING_HOST" == githolt.com || "$STAGING_HOST" == www.githolt.com ]]; then
    log "STAGING_HOST is production's host ($STAGING_HOST); staging needs its own"; exit 1
fi
export STAGING_HOST
SITE="https://$STAGING_HOST"

# --- what should be in the preview ------------------------------------------
# Sets main_sha, CANDIDATES, fingerprint and $RUN/skipped.tsv. Called again
# after waiting for room, so the build uses what is current by then.
resolve() {
    git fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'
    main_sha="$(git rev-parse refs/remotes/origin/main)"

    CANDIDATES=()
    : > "$RUN/skipped.tsv"
    # each: "kind<TAB>name<TAB>branch<TAB>sha<TAB>title<TAB>url"
    pr_branches=" "
    while IFS=$'\t' read -r num branch title url; do
        [[ -z "$num" ]] && continue
        git fetch -q origin "+refs/pull/$num/head:refs/remotes/pr/$num"
        sha="$(git rev-parse "refs/remotes/pr/$num")"
        CANDIDATES+=("pr"$'\t'"#$num"$'\t'"$branch"$'\t'"$sha"$'\t'"$title"$'\t'"$url")
        pr_branches+="$branch "
    done < <(gh pr list -R "$REPO" --label staging --state open --limit 50 \
                --json number,headRefName,title,url \
                --jq 'sort_by(.number) | .[] | [.number, .headRefName, .title, .url] | @tsv')

    # extra-branches: union of the file on main and in each labelled PR.
    {
        git show "$main_sha:deploy/staging/extra-branches" 2>/dev/null || true
        for c in "${CANDIDATES[@]}"; do
            git show "$(cut -f4 <<<"$c"):deploy/staging/extra-branches" 2>/dev/null || true
        done
    } | sed 's/#.*//; s/[[:space:]]//g; /^$/d' | awk '!seen[$0]++' > "$RUN/extra"

    while read -r b; do
        [[ "$pr_branches" == *" $b "* ]] && continue    # its PR is labelled; already in
        url="https://github.com/$REPO/tree/$b"
        if sha="$(git rev-parse -q --verify "refs/remotes/origin/$b")"; then
            CANDIDATES+=("branch"$'\t'"$b"$'\t'"$b"$'\t'"$sha"$'\t'"(no PR yet)"$'\t'"$url")
        elif [[ -d "$LOCAL_REPO/.git" || -f "$LOCAL_REPO/.git" ]] \
             && git -C "$LOCAL_REPO" rev-parse -q --verify "refs/heads/$b" >/dev/null; then
            git fetch -q "$LOCAL_REPO" "+refs/heads/$b:refs/remotes/local/$b"
            sha="$(git rev-parse "refs/remotes/local/$b")"
            CANDIDATES+=("branch"$'\t'"$b"$'\t'"$b"$'\t'"$sha"$'\t'"(no PR yet; local, not pushed)"$'\t'"")
        else
            printf 'branch\t%s\t%s\t\t\t\t%s\n' "$b" "$b" "branch not found on origin or locally" >> "$RUN/skipped.tsv"
        fi
    done < "$RUN/extra"
    fingerprint="$( { echo "host $STAGING_HOST"; echo "main $main_sha"; printf '%s\n' "${CANDIDATES[@]}" | cut -f1-4; cat "$RUN/skipped.tsv"; } | sha256sum | cut -c1-16)"
}

declare -a CANDIDATES=()
resolve
if [[ "$FORCE" != 1 && "$fingerprint" == "$(cat "$STATE/fingerprint" 2>/dev/null || true)" ]]; then
    exit 0   # nothing changed; stay quiet so the journal stays readable
fi
log "change detected (main ${main_sha:0:7}, ${#CANDIDATES[@]} branch(es))"

# --- build-info JSON (/__build) -----------------------------------------------
BUILD_DIR="$DEPLOY/build"
write_build_json() {   # status message [preview_sha]
    mkdir -p "$BUILD_DIR"
    STATUS="$1" MESSAGE="$2" PREVIEW="${3:-}" MAIN="$main_sha" RUN="$RUN" STATE="$STATE" \
    OUT="$BUILD_DIR/build.json" REPO="$REPO" SITE="$SITE" python3 - <<'PY'
import json, os, datetime
env = os.environ
def rows(name, keys):
    out = []
    with open(os.path.join(env["RUN"], name), encoding="utf-8") as f:
        for line in f:
            vals = line.rstrip("\n").split("\t")
            d = {k: v for k, v in zip(keys, vals) if v}
            if d.get("sha"):
                d["short"] = d["sha"][:7]
            out.append(d)
    return out
keys = ["kind", "name", "branch", "sha", "title", "url"]
attempt = {
    "status": env["STATUS"],
    "message": env["MESSAGE"],
    "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "main": {"sha": env["MAIN"], "short": env["MAIN"][:7],
             "url": f"https://github.com/{env['REPO']}/commit/{env['MAIN']}"},
    "preview_sha": env["PREVIEW"] or None,
    "included": rows("included.tsv", keys),
    "skipped": rows("skipped.tsv", keys + ["reason"]),
}
live_path = os.path.join(env["STATE"], "live.json")
if env["STATUS"] == "live":
    live = dict(attempt, built_at=attempt["at"])
    for k in ("status", "message", "at"):
        live.pop(k)
    with open(live_path, "w", encoding="utf-8") as f:
        json.dump(live, f, indent=2)
try:
    with open(live_path, encoding="utf-8") as f:
        live = json.load(f)
except FileNotFoundError:
    live = None
try:
    with open(os.path.join(env["STATE"], "smoke.json"), encoding="utf-8") as f:
        smoke = json.load(f)
except FileNotFoundError:
    smoke = None
doc = {"site": env["SITE"], "live": live, "smoke": smoke, "last_attempt": attempt}
tmp = env["OUT"] + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
os.replace(tmp, env["OUT"])
PY
}

# --- wait for room ------------------------------------------------------------
wait_for_room() {
    local load avail
    waited=0
    while :; do
        load="$(cut -d' ' -f1 /proc/loadavg)"
        avail="$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)"
        if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN{exit !(l < m)}' && (( avail > MIN_AVAIL_MB )); then
            return 0
        fi
        (( waited >= MAX_WAIT )) && { log "still busy after ${MAX_WAIT}s (load $load, ${avail} MB free); next tick retries"; return 1; }
        (( waited == 0 )) && log "waiting for room: load $load (< $MAX_LOAD), MemAvailable ${avail} MB (> $MIN_AVAIL_MB)"
        sleep 30; waited=$((waited + 30))
    done
}

if [[ "$FORCE" != 1 ]]; then
    if ! wait_for_room; then
        write_build_json waiting "waiting for the server to be less busy" || true
        exit 0
    fi
    (( waited > 0 )) && resolve   # things may have moved while we waited
fi

# --- merge --------------------------------------------------------------------
git checkout -q -f --detach "$main_sha"
for c in "${CANDIDATES[@]}"; do
    IFS=$'\t' read -r kind name branch sha title url <<<"$c"
    if git merge -q --no-ff --no-edit -m "staging: merge $name ($branch)" "$sha" >"$RUN/merge.out" 2>&1; then
        printf '%s\n' "$c" >> "$RUN/included.tsv"
        log "included $name ${sha:0:7}"
    else
        files="$(git diff --name-only --diff-filter=U | head -20 | paste -sd' ' -)"
        git merge --abort 2>/dev/null || git reset -q --hard
        reason="conflicts with main or a branch merged before it${files:+ in: $files}"
        [[ -z "$files" ]] && reason="merge failed: $(tail -1 "$RUN/merge.out")"
        printf '%s\t%s\n' "$c" "$reason" >> "$RUN/skipped.tsv"
        log "skipped $name: $reason"
    fi
done
preview_sha="$(git rev-parse HEAD)"

fail() {   # record a failed attempt; don't retry the same inputs until something moves
    log "FAILED: $1"
    write_build_json failed "$1" "$preview_sha" || true
    echo "$fingerprint" > "$STATE/fingerprint"
    exit 1
}

[[ -f "$DEPLOY/compose.yml" ]] || fail "the preview has no deploy/staging/compose.yml (is the deploy PR labelled staging, or merged?)"
[[ -f "$SRC/web/package.json" ]] || fail "the preview has no web/ app (is the web branch labelled or in extra-branches?)"
[[ -f "$DEPLOY/.env" ]] || "$DEPLOY/make-env.sh"

# The policy pages' contact details come from ~/.config/holt/secrets.env
# (CONTACT_EMAIL, CONTACT_CITY), the same file production reads, so staging
# shows what production will. Only these two keys and the STAGING_* ones
# below (and STAGING_CF_ACCESS_* for the smoke run) are taken from it: the
# rest of that file is production's. A missing contact value fails the build
# here instead of shipping the literal placeholders.
SECRETS="${HOLT_SECRETS_FILE:-$HOME/.config/holt/secrets.env}"
secret() {   # secret KEY: the value of KEY=value in $SECRETS, else empty
    [[ -f "$SECRETS" ]] || return 0
    sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?$1[[:space:]]*=[[:space:]]*//p" "$SECRETS" \
        | tail -1 | sed "s/[[:space:]]*\(#.*\)\?\$//; s/^\"\(.*\)\"\$/\1/; s/^'\(.*\)'\$/\1/"
}
export NEXT_PUBLIC_CONTACT_EMAIL="${NEXT_PUBLIC_CONTACT_EMAIL:-$(secret CONTACT_EMAIL)}"
export NEXT_PUBLIC_CONTACT_CITY="${NEXT_PUBLIC_CONTACT_CITY:-$(secret CONTACT_CITY)}"
for k in CONTACT_EMAIL CONTACT_CITY; do
    v="NEXT_PUBLIC_$k"
    [[ -n "${!v}" && "${!v}" != "$k" ]] || fail "$k is not set in $SECRETS; the policy pages would show the placeholder"
done

# Staging-only sign-in, optional: STAGING_GITHUB_OAUTH_ID/SECRET and
# STAGING_GOOGLE_OAUTH_ID/SECRET in the same file, from OAuth apps made for
# https://$STAGING_HOST. Production's keys (GITHUB_OAUTH_*, GOOGLE_OAUTH_*)
# are never read as a fallback, and a staging key that equals production's
# is refused. AUTH_* is always exported, empty when off, so nothing in .env
# or the caller's environment can turn a provider on instead.
staging_oauth() {   # staging_oauth GITHUB|GOOGLE display-name
    local p="$1" name="$2" id key
    id="$(secret "STAGING_${p}_OAUTH_ID")"
    key="$(secret "STAGING_${p}_OAUTH_SECRET")"
    if [[ -z "$id" && -z "$key" ]]; then
        log "$name sign-in: off (no STAGING_${p}_OAUTH_ID/SECRET)"
    elif [[ -z "$id" || -z "$key" ]]; then
        log "$name sign-in: off (STAGING_${p}_OAUTH_ID and STAGING_${p}_OAUTH_SECRET are needed together)"
        id="" key=""
    elif [[ "$id" == "$(secret "${p}_OAUTH_ID")" || "$key" == "$(secret "${p}_OAUTH_SECRET")" ]]; then
        log "$name sign-in: off (STAGING_${p}_OAUTH_* is production's key; make a separate OAuth app for $STAGING_HOST)"
        id="" key=""
    else
        log "$name sign-in: on"
    fi
    export "AUTH_${p}_ID=$id" "AUTH_${p}_SECRET=$key"
}
staging_oauth GITHUB GitHub
staging_oauth GOOGLE Google

# The server's GitHub token, fresh on every run, as production does
# (deploy/prod/env.sh): GITHUB_TOKENS from $SECRETS, else the current
# `gh auth token`. Exported, so it wins over the copy make-env.sh wrote into
# .env once (a token rotated since then would be revoked). Each token is
# checked against GitHub first, sent on curl's stdin so it never shows in
# `ps`; one that GitHub refuses stops the run here, not at the first
# uncached report. That failure doesn't record the fingerprint, so the next
# tick tries again once the token is fixed.
GITHUB_TOKENS="$(secret GITHUB_TOKENS)"
if [[ -n "$GITHUB_TOKENS" ]]; then
    log "GITHUB_TOKENS: from $SECRETS"
else
    GITHUB_TOKENS="$(gh auth token 2>/dev/null || true)"
    [[ -n "$GITHUB_TOKENS" ]] || fail "no GitHub token: put GITHUB_TOKENS in $SECRETS or run gh auth login"
    log "GITHUB_TOKENS: using gh auth token (no $SECRETS entry)"
fi
export GITHUB_TOKENS
n=0
for t in ${GITHUB_TOKENS//,/ }; do
    n=$((n + 1))
    code="$(printf 'Authorization: Bearer %s\n' "$t" \
        | curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @- https://api.github.com/rate_limit || true)"
    if [[ "$code" == 401 ]]; then
        msg="GitHub refused token $n in GITHUB_TOKENS (401: revoked or expired); update GITHUB_TOKENS in $SECRETS or run gh auth login"
        log "FAILED: $msg"
        write_build_json failed "$msg" "$preview_sha" || true
        exit 1
    fi
done

# --- build and restart this stack only ------------------------------------------
write_build_json building "building ${preview_sha:0:7}" "$preview_sha"
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    # A builder of our own: its cache can be pruned without touching anyone else's.
    docker buildx create --name "$BUILDER" --driver docker-container \
        --driver-opt memory=3g --driver-opt "env.BUILDKIT_STEP_LOG_MAX_SIZE=10485760" >/dev/null
fi
export BUILDX_BUILDER="$BUILDER" COMPOSE_PROJECT_NAME="$PROJECT"
compose() { docker compose -p "$PROJECT" -f "$DEPLOY/compose.yml" --env-file "$DEPLOY/.env" "$@"; }
port="$(sed -n 's/^HOLT_STAGE_PORT=//p' "$DEPLOY/.env")"; port="${port:-9110}"

blog="$STATE/logs/build-$(date -u +%Y%m%dT%H%M%SZ).log"
log "building (log: $blog)"
# One image at a time: two builds at once is too much for this box.
for svc in server web; do
    if ! compose build "$svc" >>"$blog" 2>&1; then
        fail "$svc image build failed; last lines: $(tail -5 "$blog" | tr '\n' ' ' | cut -c1-600)"
    fi
done
compose up -d --remove-orphans >>"$blog" 2>&1 || fail "compose up failed; see $blog"

ok=0
for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$port/" || true)"
    [[ "$code" == 200 ]] && { ok=1; break; }
    sleep 5
done
(( ok )) || fail "the site did not answer 200 within 5 minutes (last status $code); see $blog"

rm -f "$STATE/smoke.json"   # belongs to the previous build
write_build_json live "live" "$preview_sha"
echo "$fingerprint" > "$STATE/fingerprint"
log "live: ${preview_sha:0:7} on 127.0.0.1:$port ($SITE)"

# --- smoke tests (e2e/) against the public URL --------------------------------------
# Once per live build, one browser at a time. A failure doesn't roll back; it shows
# on /__build as "smoke": {"status": "failed", "failures": [...]}.
write_smoke() {   # status message [playwright-json-report]
    STATUS="$1" MESSAGE="$2" REPORT="${3:-}" PREVIEW="$preview_sha" OUT="$STATE/smoke.json" python3 - <<'PY'
import json, os, re, datetime
env = os.environ
doc = {"status": env["STATUS"], "message": env["MESSAGE"], "preview_sha": env["PREVIEW"],
       "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
if env["REPORT"] and os.path.exists(env["REPORT"]):
    with open(env["REPORT"], encoding="utf-8") as f:
        rep = json.load(f)
    failures = []
    def walk(suite, trail):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                if t.get("status") == "unexpected":
                    err = next((r.get("error", {}).get("message", "") for r in t.get("results", []) if r.get("error")), "")
                    failures.append({"test": " > ".join(trail + [spec["title"]]), "project": t.get("projectName"),
                                     "error": " ".join(re.sub(r"\x1b\[[0-9;]*m", "", err).split())[:300]})
        for sub in suite.get("suites", []):
            walk(sub, trail)
    for s in rep.get("suites", []):
        walk(s, [])
    st = rep.get("stats", {})
    doc.update(passed=st.get("expected", 0), failed=st.get("unexpected", 0), skipped=st.get("skipped", 0),
               flaky=st.get("flaky", 0), duration_s=round(st.get("duration", 0) / 1000), failures=failures)
with open(env["OUT"], "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
PY
    write_build_json live "live" "$preview_sha" || true
}

# Behind Cloudflare Access, the smoke run gets through with a service token:
# STAGING_CF_ACCESS_CLIENT_ID/SECRET from $SECRETS, passed to that one command
# only and never logged. e2e/ trades it for Access's cookie on $STAGING_HOST
# alone (e2e/README.md). Without both keys the run is the same as before.
E2E="$SRC/e2e"
if [[ -f "$E2E/package.json" && "${HOLT_STAGE_SMOKE:-1}" == 1 ]]; then
    slog="$STATE/logs/smoke-$(date -u +%Y%m%dT%H%M%SZ).log"
    cf_id="$(secret STAGING_CF_ACCESS_CLIENT_ID)"
    cf_secret="$(secret STAGING_CF_ACCESS_CLIENT_SECRET)"
    if [[ -n "$cf_id" && -n "$cf_secret" ]]; then
        log "smoke: through Cloudflare Access with the service token"
    else
        [[ -n "$cf_id$cf_secret" ]] && log "smoke: no Cloudflare Access token (STAGING_CF_ACCESS_CLIENT_ID and STAGING_CF_ACCESS_CLIENT_SECRET are needed together)"
        cf_id="" cf_secret=""
    fi
    write_smoke running "running the smoke tests"
    if ! (cd "$E2E" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund) >"$slog" 2>&1; then
        write_smoke failed "couldn't install the smoke tests (npm ci); see $slog"
    else
        report="$RUN/smoke.json"
        if (cd "$E2E" && PLAYWRIGHT_JSON_OUTPUT_NAME="$report" BASE_URL="$SITE" \
                STAGING_CF_ACCESS_CLIENT_ID="$cf_id" STAGING_CF_ACCESS_CLIENT_SECRET="$cf_secret" \
                timeout 900 npx playwright test --workers=1 --reporter=json) >>"$slog" 2>&1; then
            write_smoke passed "all smoke tests passed" "$report"
        elif [[ -s "$report" ]]; then
            write_smoke failed "some smoke tests failed; see failures" "$report"
        else
            write_smoke failed "the smoke run crashed or timed out; see $slog"
        fi
    fi
    log "smoke: $(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["status"], d.get("passed",""), "passed", d.get("failed",""), "failed")' "$STATE/smoke.json")"
    ls -1t "$STATE"/logs/smoke-*.log 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

# --- clean up after ourselves only ----------------------------------------------------
docker image prune -f --filter "label=$LABEL" >/dev/null || true
docker buildx prune --builder "$BUILDER" -f --max-used-space 3gb >/dev/null 2>&1 || true
ls -1t "$STATE"/logs/build-*.log 2>/dev/null | tail -n +11 | xargs -r rm -f
