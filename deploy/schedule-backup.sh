#!/usr/bin/env bash
# OpenEOC scheduled backup for the Docker deployment. Installs a systemd
# service that runs backup.sh as the install account and a timer that starts
# it daily. The timer is persistent: a run missed while the host was off
# happens at the next boot. Then it takes one backup through the service, so
# a schedule that cannot work fails now rather than on the day it is needed.
# Run once with sudo from deploy/; run it again to change the settings. See
# docs/guides/DISASTER-RECOVERY.md.
#
#   sudo ./schedule-backup.sh [backup directory, default <deploy>/backups]
#
# OPENEOC_BACKUP_SCHEDULE   systemd calendar value, default "*-*-* 02:30:00"
# OPENEOC_BACKUP_KEEP_DAYS  days of backups kept, default 14
# OPENEOC_BACKUP_USER       account that runs backup.sh, default the owner of
#                           deploy/.env (the account that ran install.sh)
# OPENEOC_SYSTEMD_DIR       where the unit files go, default /etc/systemd/system
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '[openeoc] %s\n' "$*"; }
fail() { printf '[openeoc] %s\n' "$*" >&2; exit 1; }

out_dir="${1:-$here/backups}"
schedule="${OPENEOC_BACKUP_SCHEDULE:-*-*-* 02:30:00}"
keep_days="${OPENEOC_BACKUP_KEEP_DAYS:-14}"
unit_dir="${OPENEOC_SYSTEMD_DIR:-/etc/systemd/system}"

command -v systemctl >/dev/null 2>&1 \
  || fail "systemd is required. Without it, use the cron line in docs/guides/DISASTER-RECOVERY.md."
[ -f "$here/.env" ] || fail "deploy/.env is missing, so there is no install here to back up. Run install.sh."
[[ "$out_dir" == /* ]] || fail "Give the backup directory as an absolute path."
[[ "$here$out_dir" != *%* && "$here$out_dir" != *'"'* && "$here$out_dir" != *'\'* ]] \
  || fail "The deploy and backup paths must not contain %, \" or \\, which a unit file reads specially."
[[ "$keep_days" =~ ^[1-9][0-9]*$ ]] || fail "OPENEOC_BACKUP_KEEP_DAYS must be a whole number of days, 1 or more."
[[ "$schedule" =~ ^[A-Za-z0-9*:/.,~\ -]+$ ]] \
  || fail "OPENEOC_BACKUP_SCHEDULE must be a systemd calendar value, such as '*-*-* 02:30:00'."
user="${OPENEOC_BACKUP_USER:-$(stat -c %U "$here/.env")}"
[ -w "$unit_dir" ] || fail "Cannot write $unit_dir. Run with sudo."

cat > "$unit_dir/openeoc-backup.service" <<EOF
[Unit]
Description=OpenEOC backup of the database and uploaded files
After=docker.service

[Service]
Type=oneshot
User=$user
Environment=OPENEOC_BACKUP_KEEP_DAYS=$keep_days
ExecStart=/usr/bin/env bash "$here/backup.sh" "$out_dir"
EOF

cat > "$unit_dir/openeoc-backup.timer" <<EOF
[Unit]
Description=Scheduled OpenEOC backup

[Timer]
OnCalendar=$schedule
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now openeoc-backup.timer
say "Taking one backup through the new service"
systemctl start openeoc-backup.service \
  || fail "The backup failed; see: journalctl -u openeoc-backup.service. The timer is enabled; fix the cause and run: sudo systemctl start openeoc-backup.service"
say "Backups run at '$schedule' as $user into $out_dir and are kept $keep_days days."
say "Next run: systemctl list-timers openeoc-backup.timer. Each run's output: journalctl -u openeoc-backup.service"
