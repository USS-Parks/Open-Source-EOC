#!/usr/bin/env bash
# OpenEOC upgrade for the Docker deployment. Run it from deploy/ once the
# source tree holds the new release. It takes a fresh backup with backup.sh
# first and stops, changing nothing, unless the database dump is complete and
# the file archive is readable. There is no switch to skip the backup. Then it
# rebuilds the images, recreates the stack (the API applies any new
# migrations as it starts), waits until the API reports ready, and prints the
# backup to return to. See docs/guides/UPGRADE.md.
#
#   ./upgrade.sh [backup directory, default ./backups]
set -euo pipefail
# The backup holds the whole database; keep it private to this account.
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

say() { printf '\n\033[1m[openeoc]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31m[openeoc] %s\033[0m\n' "$*" >&2; exit 1; }
# wait_for <tries> <seconds> <command...>: succeeds as soon as the command does.
wait_for() {
  local tries="$1" delay="$2"
  shift 2
  for _ in $(seq 1 "$tries"); do
    "$@" && return 0
    sleep "$delay"
  done
  return 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required."
docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is required."
command -v curl >/dev/null 2>&1 || fail "curl is required."
[ -f .env ] || fail "deploy/.env is missing, so there is no install here to upgrade. Run install.sh."
grep -q '^OPENEOC_DOMAIN=' .env && grep -q '^OPENEOC_TLS=' .env \
  || fail "deploy/.env predates the HTTPS front end. Run install.sh once with a host name and a certificate choice, then run upgrade.sh."

# The API is published on this host's loopback only.
api="http://127.0.0.1:8080/api/v1"
running_version() { curl -fsS "$api/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
api_ready() { curl -fsS "$api/ready" 2>/dev/null | grep '"ready"' >/dev/null; }
before="$(running_version || true)"
say "Running version: ${before:-unknown}"

say "Backing up before the upgrade"
out="$(bash ./backup.sh "${1:-./backups}" 2>&1)" || {
  printf '%s\n' "$out" >&2
  fail "The backup failed, so nothing was upgraded. backup.sh needs the db and api services running (docker compose up -d). Fix the cause above and run upgrade.sh again."
}
printf '%s\n' "$out"
db_file="$(printf '%s\n' "$out" | sed -n 's/^\[openeoc\] database backup written: //p')"
blob_file="$(printf '%s\n' "$out" | sed -n 's/^\[openeoc\] blob backup written: //p')"
# A dump that ran to the end closes with pg_dump's completion comment.
[ -s "$db_file" ] && gunzip -c "$db_file" | tail -n 20 | grep '^-- PostgreSQL database dump complete' >/dev/null \
  || fail "The database backup ${db_file:-(none reported)} is empty or incomplete, so nothing was upgraded."
[ -s "$blob_file" ] && gzip -t "$blob_file" \
  || fail "The file backup ${blob_file:-(none reported)} is empty or damaged, so nothing was upgraded."
say "Backup complete: $db_file and $blob_file"

say "Building the new images"
docker compose build \
  || fail "The build failed. The stack still runs the previous version. The backup taken before this upgrade is $db_file."

say "Restarting the stack; the API applies any new migrations as it starts"
docker compose up -d \
  || fail "The stack did not start. See: docker compose logs api. The backup taken before this upgrade is $db_file; docs/guides/UPGRADE.md explains how to go back with it."

say "Waiting for the API to report ready"
wait_for 60 5 api_ready \
  || fail "The API did not report ready. See: docker compose logs api. The backup taken before this upgrade is $db_file; docs/guides/UPGRADE.md explains how to go back with it."

after="$(running_version || true)"
say "Upgraded from ${before:-unknown} to ${after:-unknown}. The backup taken before the upgrade is $db_file with $blob_file; keep both until the new version has run through an operational period."
