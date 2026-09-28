#!/usr/bin/env bash
# backup.sh -- nightly pg_dump of the production databases.
#
# Writes ~/backups/holt/<UTC timestamp>/{holt,holt_web,umami}.dump (pg_dump custom
# format, compressed) plus globals.sql (roles), and deletes sets older than
# 14 days. install.sh schedules it at 03:30 UTC via a systemd --user timer;
# by hand: deploy/prod/backup.sh. Restore steps are in README.md.
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
DEST="${HOLT_BACKUP_DIR:-$HOME/backups/holt}"
KEEP_DAYS="${HOLT_BACKUP_KEEP_DAYS:-14}"
PROJECT="${HOLT_PROD_PROJECT:-holt-prod}"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
# warm-meta.sh waits on this, so the daily details pass never runs during a dump.
STATE="${HOLT_PROD_HOME:-$HOME/.local/share/holt-prod}"
mkdir -p "$STATE"
exec 7>"$STATE/backup.lock"
flock -w 3600 7 || { log "ERROR: $STATE/backup.lock held for an hour"; exit 1; }

db="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=db" --filter status=running | head -1)"
[[ -n "$db" ]] || { log "ERROR: the $PROJECT db container is not running"; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DEST/$stamp"
umask 077
mkdir -p "$out"
# umami: only once deploy/prod/umami.sh has created it.
names="holt holt_web"
docker exec "$db" psql -U holt -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'umami'" | grep -q 1 && names="$names umami"
for name in $names; do
    docker exec "$db" pg_dump -U holt -Fc --compress=6 "$name" > "$out/$name.dump"
done
docker exec "$db" pg_dumpall -U holt --globals-only > "$out/globals.sql"
log "backup $out: $(du -sh "$out" | cut -f1)"

# Retention: whole sets older than KEEP_DAYS.
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
log "kept $(find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l) backup set(s) in $DEST"
