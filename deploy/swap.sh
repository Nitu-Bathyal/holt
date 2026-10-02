#!/usr/bin/env bash
# swap.sh -- replace a compose service's containers with no gap in service.
# Sourced by prod/deploy.sh and staging/preview.sh; not a script to run.
# Calls the caller's `compose` function.
#
#   swap_service <svc> [timeout]
#
# Starts new containers of <svc> from the current compose config (the new
# image tag and env) next to the running ones, as many as the config asks
# for (`deploy.replicas`; one without it), waits until every one of them
# passes its health check, then stops and removes the old ones. While both
# sets run, all of them answer to the service's name on the network: the
# edge re-resolves `web` every couple of seconds and tries another address
# when one refuses, and web reaches `server` the same way, so nobody sees
# the swap. (This is what `docker compose up -d` can't do: it stops the old
# container first, and for those seconds Cloudflare showed its 502 page.)
#
# If any new container isn't healthy within <timeout> seconds (default 180)
# or exits, all the new ones are removed and the old ones keep serving:
# returns 1 and SWAP_MSG says why, with the failed container's last log
# lines. On success SWAP_MSG says how long it took. A service with no
# container yet is just started (and waited for); one whose containers
# already run the current config and image, in the number asked for, is
# left alone.
#
# Needs a healthcheck on <svc> (compose.yml); a service without one counts
# as ready once it is running. The service must not publish a host port or
# set container_name, since twice its containers run at once for a moment.

SWAP_STOP_WAIT="${SWAP_STOP_WAIT:-30}"   # seconds the old containers get to finish their requests
SWAP_SETTLE="${SWAP_SETTLE:-3}"         # seconds both sets run once the new one is healthy: longer
                                        # than the edge's DNS cache (resolver valid=2s), so it knows all

# The service's own containers. Not one-off ones (`compose run`, such as
# prod's warm pass, which runs the server image as a `server` container):
# counted, they made the scale-up start two new containers and the swap fail.
_swap_ids() {
    local id
    for id in $(compose ps -a -q "$1" 2>/dev/null); do
        [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$id" 2>/dev/null)" == True ]] || echo "$id"
    done | sort
}

_swap_state() {   # healthy | starting | unhealthy | running (no healthcheck) | exited | crashing | ...
    local out
    out="$(docker inspect -f '{{.RestartCount}} {{if .State.Health}}{{if eq .State.Status "running"}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null)" \
        || { echo gone; return; }
    # restart: unless-stopped brings a crashing container back up, again and
    # again; once is enough to know it won't do.
    if [[ "${out%% *}" != 0 ]]; then echo "crashing (restarted ${out%% *}x)"; else echo "${out#* }"; fi
}

_swap_current() {   # svc id: the one container already runs this config and image
    local want have ref
    want="$(compose config --hash "$1" 2>/dev/null | awk '{print $2}')"
    have="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}} {{.Image}} {{.State.Status}} {{.Config.Image}}' "$2" 2>/dev/null)" || return 1
    ref="${have##* }"
    [[ -n "$want" && "$have" == "$want $(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null) running $ref" ]]
}

# How many containers the compose config asks for: `deploy.replicas` (or
# `scale`), 1 without. Read from the config in force, so a rollback with the
# previous release's compose file goes back to that release's number.
_swap_replicas() {
    local n
    n="$(compose config --format json 2>/dev/null | python3 -c '
import json, sys
svc = json.load(sys.stdin)["services"][sys.argv[1]]
print(svc.get("scale") or (svc.get("deploy") or {}).get("replicas") or 1)' "$1" 2>/dev/null)"
    [[ "$n" =~ ^[1-9][0-9]*$ ]] && echo "$n" || echo 1
}

swap_service() {
    local svc="$1" timeout="${2:-180}" old new n want id state bad pending current=1 started=$SECONDS
    local news retired olds="the old one keeps" gone="it was"
    SWAP_MSG=
    old="$(_swap_ids "$svc")"
    n="$(printf '%s' "$old" | grep -c . || true)"
    want="$(_swap_replicas "$svc")"
    (( n > 1 )) && olds="the old ones keep"
    (( want > 1 )) && gone="all $want new ones were"
    # Nothing new for it (same config, same image, same number): leave it
    # running, as `compose up -d` would. A server restart would interrupt
    # its jobs.
    if (( n == want )); then
        for id in $old; do _swap_current "$svc" "$id" || { current=0; break; }; done
        if (( current )); then
            SWAP_MSG="$svc: unchanged, left running"
            return 0
        fi
    fi
    # --no-recreate keeps the old containers as they are; the extra ones are
    # created from the config as it is now.
    if ! compose up -d --no-deps --no-recreate --scale "$svc=$((n + want))" "$svc" >/dev/null 2>&1; then
        new="$(comm -13 <(printf '%s\n' "$old") <(_swap_ids "$svc") | grep . || true)"
        [[ -n "$new" ]] && docker rm -f $new >/dev/null 2>&1
        SWAP_MSG="$svc: compose couldn't start the new containers; $olds serving"
        return 1
    fi
    new="$(comm -13 <(printf '%s\n' "$old") <(_swap_ids "$svc") | grep . || true)"
    if [[ "$(printf '%s' "$new" | grep -c . || true)" != "$want" ]]; then
        [[ -n "$new" ]] && docker rm -f $new >/dev/null 2>&1
        SWAP_MSG="$svc: expected $want new, found '$(echo $new)'; $olds serving"
        return 1
    fi
    # Every new one must be healthy; the first that isn't ends the wait.
    while :; do
        bad= pending=
        for id in $new; do
            state="$(_swap_state "$id")"
            case "$state" in
                healthy|running) ;;
                starting|created) pending="${pending:-$id}" ;;
                *) bad="$id"; break ;;
            esac
        done
        [[ -n "$bad" || -z "$pending" ]] && break
        (( SECONDS - started >= timeout )) && { bad="$pending" state="not healthy after ${timeout}s"; break; }
        sleep 1
    done
    if [[ -n "$bad" ]]; then
        SWAP_MSG="$svc: a new container is $state, so $gone removed and $olds serving. Its last lines: $(docker logs --tail 5 "$bad" 2>&1 | tr '\n' ' ' | cut -c1-600)"
        docker rm -f $new >/dev/null 2>&1
        return 1
    fi
    if [[ -n "$old" ]]; then
        sleep "$SWAP_SETTLE"
        # docker stop: SIGTERM, then up to SWAP_STOP_WAIT for open requests.
        docker stop -t "$SWAP_STOP_WAIT" $old >/dev/null 2>&1 || true
        docker rm -f $old >/dev/null 2>&1 || true
    fi
    news="new container"; (( want > 1 )) && news="$want new containers"
    retired=", old one retired"; (( n > 1 )) && retired=", old ones retired"
    SWAP_MSG="$svc: $news healthy after $((SECONDS - started))s${old:+$retired}"
}
