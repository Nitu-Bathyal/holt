#!/usr/bin/env bash
# One-time setup of the production extras on this box. It installs no
# deploy timer: production only changes when someone runs deploy.sh.
#
#   deploy/prod/install.sh        write .env if missing, install the nightly
#                                 backup timer and the daily repo-details timer
#
# - copies backup.sh and warm-meta.sh to ~/.local/share/holt-prod/bin/ (the
#   timers run those copies, so they keep working when worktrees come and go;
#   re-run install.sh after editing either)
# - writes the systemd --user units holt-prod-backup.service / .timer
#   (03:30 UTC daily; dumps to ~/backups/holt, keeps 14 days)
# - writes holt-prod-warm-meta.service / .timer (05:00 UTC daily: re-reads
#   the repository details Discover shows; warm-meta.sh)
# No sudo. Needs linger so the timer runs while logged out
# (`loginctl show-user $USER -p Linger`).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
STATE="${HOLT_PROD_HOME:-$HOME/.local/share/holt-prod}"
UNITS="$HOME/.config/systemd/user"

mkdir -p "$STATE/bin" "$UNITS" "$HOME/backups/holt"
"$here/make-env.sh"
install -m 755 "$here/backup.sh" "$STATE/bin/backup.sh"
install -m 755 "$here/warm-meta.sh" "$STATE/bin/warm-meta.sh"

cat > "$UNITS/holt-prod-backup.service" <<UNIT
[Unit]
Description=Holt production: nightly pg_dump to ~/backups/holt
After=docker.service

[Service]
Type=oneshot
ExecStart=$STATE/bin/backup.sh
Nice=10
IOSchedulingClass=idle
UNIT

cat > "$UNITS/holt-prod-backup.timer" <<UNIT
[Unit]
Description=Holt production database backup, nightly

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > "$UNITS/holt-prod-warm-meta.service" <<UNIT
[Unit]
Description=Holt production: re-read the repository details Discover shows
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=$STATE/bin/warm-meta.sh
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=90min
UNIT

# After the backup (03:30), away from it; warm-meta.sh also waits on the
# backup's and deploy.sh's locks.
cat > "$UNITS/holt-prod-warm-meta.timer" <<UNIT
[Unit]
Description=Holt production repository details, daily

[Timer]
OnCalendar=*-*-* 05:00:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now holt-prod-backup.timer holt-prod-warm-meta.timer
systemctl --user list-timers holt-prod-backup.timer holt-prod-warm-meta.timer --no-pager
