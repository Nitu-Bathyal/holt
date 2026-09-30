#!/usr/bin/env bash
# github-app.sh -- who production reads GitHub as, and whether it works.
#
#   deploy/prod/github-app.sh
#
# Runs `python -m holt_server.github_app` in the deployed server image with
# production's environment (env.sh reads the secrets file): the GitHub App's
# name, its installation, the GraphQL points left, and a read of a public
# repository outside holt-oss the way a report does. Prints no token or key.
# Without the App set up it says so (the server reads with GITHUB_TOKENS).
# Exits non-zero when the App is set up but doesn't work.
# The maintainers' ops notes are the owner's guide.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=env.sh
. "$here/env.sh"   # STATE, PROJECT, load_prod_env
sha="$(cat "$STATE/current" 2>/dev/null || true)"
[[ -n "$sha" ]] || { echo "nothing deployed yet (no $STATE/current)"; exit 1; }
export HOLT_SRC="$STATE/src" HOLT_TAG="$sha" HOLT_PROD_HOME="$STATE" HOLT_PROD_PROJECT="$PROJECT"
load_prod_env
exec docker compose -p "$PROJECT" -f "$here/compose.yml" --env-file "$STATE/.env" \
    run --rm --no-deps server python -m holt_server.github_app
