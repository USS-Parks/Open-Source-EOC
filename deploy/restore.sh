#!/usr/bin/env bash
# OpenEOC restore (VEOC-40). Restores a database dump produced by backup.sh
# into a running database, and the matching blob archive into the api
# container. Destructive to the database: it drops and recreates the schema,
# so it refuses to run without an explicit confirmation argument. The blob
# restore is additive: bytes are content-addressed, so extracting the archive
# only ever re-supplies files the restored rows point at.
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

echo "[openeoc] restoring database from $file"
gunzip -c "$file" | docker compose exec -T db psql -U openeoc_owner -d openeoc

# The blob archive shares the timestamp: openeoc-<stamp>.sql.gz pairs with
# openeoc-<stamp>.blobs.tar.gz. Restore it when present.
blob_file="${file%.sql.gz}.blobs.tar.gz"
if [ -f "$blob_file" ]; then
  echo "[openeoc] restoring blobs from $blob_file"
  gunzip -c "$blob_file" | docker compose exec -T api tar -C /data/blobs -xf -
else
  echo "[openeoc] warning: no blob archive at $blob_file; file downloads will 404 until blobs are restored" >&2
fi

echo "[openeoc] restore complete"
