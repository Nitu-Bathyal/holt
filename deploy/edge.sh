#!/usr/bin/env bash
# edge.sh -- put a changed edge.conf live without restarting the edge.
# Sourced by prod/deploy.sh and staging/preview.sh; not a script to run.
# Both functions call the caller's `compose` function.
#
# The edge mounts a directory and reads default.conf from it, never the
# repo's edge.conf itself. A single-file bind mount pins the file's inode:
# once git replaces edge.conf, the running edge keeps reading the old one
# until the container is recreated, which a deploy never does (the Umami
# paths from #76 stayed 404 for that reason). With a directory, the new
# file is visible inside the running edge, and a reload picks it up.
#
#   edge_seed <conf> <dir>    Before `compose up`. First run only (no
#                             <dir>/default.conf yet): copies <conf> in and
#                             checks it with `nginx -t` in a one-off edge
#                             container, so a new edge never starts on a
#                             config nginx rejects. Returns 1 on a
#                             rejected config (and removes it again).
#   edge_apply <conf> <dir>   After `compose up`. When <conf> differs from
#                             <dir>/default.conf: keeps the old one as
#                             default.conf.prev, installs <conf>, runs
#                             `nginx -t` in the running edge, then
#                             `nginx -s reload`, which is graceful: the port
#                             stays open and open requests finish. On a
#                             rejected config the old file is put back (the
#                             running nginx never left it) and it returns 1.
#   edge_revert <dir>         Put default.conf.prev back and reload: for a
#                             config nginx accepted that then broke the site.
#
# EDGE_MSG says what happened, for the caller's log; after edge_apply,
# EDGE_CHANGED is 1 when a new config was loaded. Only *.conf files in
# <dir> are loaded, so default.conf.prev and the temporary file are inert.

_edge_install() {   # src dir: atomic replace, so nginx never reads half a file
    cp "$1" "$2/.default.conf.new" && mv -f "$2/.default.conf.new" "$2/default.conf"
}

_edge_tail() { printf '%s' "$1" | tail -n 4 | tr '\n' ' ' | cut -c1-600; }

edge_seed() {
    local conf="$1" dir="$2" out
    EDGE_MSG=
    mkdir -p "$dir"
    [[ -f "$dir/default.conf" ]] && return 0
    _edge_install "$conf" "$dir"
    if ! out="$(compose run --rm --no-deps -T edge nginx -t 2>&1)"; then
        rm -f "$dir/default.conf"
        EDGE_MSG="nginx rejected $conf: $(_edge_tail "$out")"
        return 1
    fi
    EDGE_MSG="edge config installed in $dir (first run; the edge is recreated with it)"
}

edge_apply() {
    local conf="$1" dir="$2" out
    EDGE_MSG= EDGE_CHANGED=0
    if cmp -s "$conf" "$dir/default.conf"; then
        EDGE_MSG="edge config unchanged"; return 0
    fi
    cp -p "$dir/default.conf" "$dir/default.conf.prev"
    _edge_install "$conf" "$dir"
    if ! out="$(compose exec -T edge nginx -t 2>&1)"; then
        _edge_install "$dir/default.conf.prev" "$dir"
        EDGE_MSG="nginx -t rejected the new edge config, so the edge keeps the previous one: $(_edge_tail "$out")"
        return 1
    fi
    if ! out="$(compose exec -T edge nginx -s reload 2>&1)"; then
        _edge_install "$dir/default.conf.prev" "$dir"
        EDGE_MSG="nginx -s reload failed, previous edge config put back: $(_edge_tail "$out")"
        return 1
    fi
    EDGE_MSG="edge config changed: nginx -t passed, edge reloaded (port kept)" EDGE_CHANGED=1
}

edge_revert() {
    local dir="$1"
    [[ -f "$dir/default.conf.prev" ]] || return 1
    _edge_install "$dir/default.conf.prev" "$dir"
    compose exec -T edge nginx -s reload >/dev/null 2>&1
}
