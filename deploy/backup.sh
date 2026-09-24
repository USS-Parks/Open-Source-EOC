#!/usr/bin/env bash
# OpenEOC backup (VEOC-40). The system of record is two parts: the database
# (boards, records, audit log, file metadata) AND the uploaded file blobs,
# which live on disk in the api container's OPENEOC_DATA_DIR, not in Postgres.
# A database-only dump restores file rows that point at missing bytes, so this
# writes both a database dump and a blob archive under one timestamp. Run on a
# schedule; keep both files together and off the box.
set -euo pipefail
# The files hold the whole database and every upload; keep them private.
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

out_dir="${1:-./backups}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
db_file="$out_dir/openeoc-$stamp.sql.gz"
blob_file="$out_dir/openeoc-$stamp.blobs.tar.gz"

# Each file is written under a .part name and renamed only when its command
# succeeded, so a failed run never leaves a file that looks like a backup.
docker compose exec -T db pg_dump -U openeoc_owner -d openeoc --no-owner \
  | gzip > "$db_file.part"
mv "$db_file.part" "$db_file"
printf '[openeoc] database backup written: %s\n' "$db_file"

# Stream the blob directory out of the api container. The bytes are
# content-addressed and immutable, so a plain archive is a consistent copy.
docker compose exec -T api tar -C /data/blobs -cf - . \
  | gzip > "$blob_file.part"
mv "$blob_file.part" "$blob_file"
printf '[openeoc] blob backup written: %s\n' "$blob_file"
