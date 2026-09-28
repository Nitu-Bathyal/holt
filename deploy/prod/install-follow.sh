#!/usr/bin/env bash
# One-time setup of production's auto-deploy (follow.sh) on this box.
#
#   deploy/prod/install-follow.sh             install + start the 2-minute timer
#   deploy/prod/install-follow.sh --no-timer  install only (run the copy by hand)
#   deploy/prod/install-follow.sh --remove    stop and remove the timer
#
# - copies follow.sh to ~/.local/share/holt-prod/bin/ (the timer runs that
#   copy, so a merged PR can't change the loop itself; re-run this script
#   after editing follow.sh). deploy.sh and warm.sh come from the commit
#   being deployed.
# - writes the systemd --user units holt-prod-follow.service / .timer
# Pausing doesn't need the timer stopped: follow.sh --pause (README.md).
# No sudo. Needs linger so the timer runs while logged out
# (`loginctl show-user $USER -p Linger`).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
STATE="${HOLT_PROD_HOME:-$HOME/.local/share/holt-prod}"
UNITS="$HOME/.config/systemd/user"

if [[ "${1:-}" == --remove ]]; then
    systemctl --user disable --now holt-prod-follow.timer 2>/dev/null || true
    rm -f "$UNITS/holt-prod-follow.service" "$UNITS/holt-prod-follow.timer"
    systemctl --user daemon-reload
    echo "removed; production deploys only by hand again (deploy.sh)"; exit 0
fi

[[ -f "$STATE/.env" ]] || { echo "no $STATE/.env: run install.sh and a first deploy.sh first" >&2; exit 1; }
mkdir -p "$STATE/bin" "$UNITS"
install -m 755 "$here/follow.sh" "$STATE/bin/follow.sh"

cat > "$UNITS/holt-prod-follow.service" <<UNIT
[Unit]
Description=Holt production: deploy origin/main once CI and staging are green on it
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=$STATE/bin/follow.sh
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=2h
UNIT

cat > "$UNITS/holt-prod-follow.timer" <<UNIT
[Unit]
Description=Check origin/main for a production deploy every 2 minutes

[Timer]
OnBootSec=3min
OnUnitInactiveSec=2min
AccuracySec=15s

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
if [[ "${1:-}" != --no-timer ]]; then
    systemctl --user enable --now holt-prod-follow.timer
    systemctl --user list-timers holt-prod-follow.timer --no-pager
fi
echo "status: $STATE/bin/follow.sh --status   pause: $STATE/bin/follow.sh --pause <reason>"
