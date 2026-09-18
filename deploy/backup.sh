#!/usr/bin/env bash
# OpenEOC backup (VEOC-40). A consistent logical dump of the whole database,
# gzip-compressed and timestamped. The database is the whole system of record
# (boards, records, audit log, files metadata), so this one dump is the
# backup. Run on a schedule; keep copies off the box.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

out_dir="${1:-./backups}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/openeoc-$stamp.sql.gz"

docker compose exec -T db pg_dump -U openeoc_owner -d openeoc --no-owner \
  | gzip > "$file"

printf '[openeoc] backup written: %s\n' "$file"
