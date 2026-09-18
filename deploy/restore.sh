#!/usr/bin/env bash
# OpenEOC restore (VEOC-40). Restores a gzip dump produced by backup.sh into
# a running database. Destructive: it drops and recreates the schema, so it
# refuses to run without an explicit confirmation argument.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

file="${1:-}"
confirm="${2:-}"
[ -n "$file" ] || { echo "usage: restore.sh <backup.sql.gz> --yes-drop-and-restore" >&2; exit 2; }
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }
[ "$confirm" = "--yes-drop-and-restore" ] || {
  echo "refusing: pass --yes-drop-and-restore to confirm this destroys the current database" >&2
  exit 2
}

echo "[openeoc] dropping and recreating the public schema"
docker compose exec -T db psql -U openeoc_owner -d openeoc \
  -c "drop schema public cascade; create schema public;"

echo "[openeoc] restoring from $file"
gunzip -c "$file" | docker compose exec -T db psql -U openeoc_owner -d openeoc

echo "[openeoc] restore complete"
