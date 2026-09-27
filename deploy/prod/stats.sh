#!/usr/bin/env bash
# stats.sh -- the product numbers, from Holt's own database. Read-only.
#
#   deploy/prod/stats.sh            the last 14 days
#   deploy/prod/stats.sh 30         the last 30 days
#
# Per UTC day: people asking for a report (the reach number: distinct
# people, signed in or not), report requests, repositories asked about,
# reports actually generated (a run, not a cache hit), searches on /find,
# and new accounts. People are counted by the daily hash in `usage_events`
# (server/holt_server/usage.py), which changes every day, so a person who
# comes back tomorrow counts again tomorrow and there is no "distinct people
# this month". No name, email, IP or user id is printed.
#
# Page views, starter-issue clicks and sign-in clicks are browser events in
# Umami (README.md, "Analytics").
set -euo pipefail
DAYS="${1:-14}"
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "usage: stats.sh [days]"; exit 2; }
PROJECT="${HOLT_PROD_PROJECT:-holt-prod}"

db="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=db" --filter status=running | head -1)"
[[ -n "$db" ]] || { echo "the $PROJECT db container is not running"; exit 1; }
q() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$db" psql -U holt -d holt -X -q -P footer=off "$@"; }

if [[ "$(q -tA -c "SELECT to_regclass('usage_events') IS NOT NULL")" != t ]]; then
    echo "(no usage_events table yet: it arrives with the first deploy that has server/holt_server/usage.py;"
    echo " until then only 'reports generated' below is known)"
    usage="SELECT NULL::text AS day, NULL::text AS kind, NULL::text AS who, NULL::boolean AS signed_in, NULL::text AS repo_key WHERE false"
else
    usage="SELECT day, kind, who, signed_in, repo_key FROM usage_events"
fi

echo "Holt, last $DAYS days (UTC)"
q <<SQL
WITH days AS (
  SELECT to_char(d, 'YYYY-MM-DD') AS day
  FROM generate_series((now() AT TIME ZONE 'utc')::date - ($DAYS - 1), (now() AT TIME ZONE 'utc')::date, interval '1 day') d
), u AS ($usage), a AS (SELECT * FROM u WHERE kind = 'analysis'),
r AS (SELECT to_char(created_at AT TIME ZONE 'utc', 'YYYY-MM-DD') AS day, mode FROM reports),
j AS (SELECT to_char(created_at AT TIME ZONE 'utc', 'YYYY-MM-DD') AS day FROM users)
SELECT days.day AS "day",
  (SELECT count(DISTINCT who) FROM a WHERE a.day = days.day) AS "people",
  (SELECT count(DISTINCT who) FROM a WHERE a.day = days.day AND signed_in) AS "signed in",
  (SELECT count(*) FROM a WHERE a.day = days.day) AS "requests",
  (SELECT count(DISTINCT repo_key) FROM a WHERE a.day = days.day) AS "repos",
  (SELECT count(*) FROM r WHERE r.day = days.day) AS "generated",
  (SELECT count(*) FROM r WHERE r.day = days.day AND mode = 'ai') AS "of them AI",
  (SELECT count(*) FROM u WHERE u.day = days.day AND kind = 'find') AS "searches",
  (SELECT count(*) FROM j WHERE j.day = days.day) AS "new accounts"
FROM days ORDER BY days.day DESC;
SQL

echo
echo "All time"
q <<SQL
SELECT
  (SELECT count(*) FROM reports) AS "reports generated",
  (SELECT count(DISTINCT repo_key) FROM reports) AS "repositories with a report",
  (SELECT count(*) FROM users) AS "accounts";
SQL
echo
echo "people = distinct people asking for a report that day (signed-in and anonymous)."
echo "generated = reports actually run (including badge refreshes and the warm pass); a request answered from the 24-hour cache isn't one."
echo "Starter-issue clicks, page views and sign-in clicks: the Umami dashboard (README.md, Analytics)."
