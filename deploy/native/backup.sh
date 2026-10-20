#!/usr/bin/env bash
# Daily PostgreSQL backup for VelisMail.
#
# Runs as the postgres user from velismail-backup.service. The database name is
# supplied through PGDATABASE by the generated unit. Backups are custom-format
# dumps (pg_restore compatible) kept for RETENTION_DAYS.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/velismail}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DB_NAME="${PGDATABASE:-velismail}"

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "backup directory ${BACKUP_DIR} does not exist" >&2
  exit 1
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
target="${BACKUP_DIR}/velismail-${stamp}.dump"

cleanup_partial() {
  rm -f "${target}"
}
trap cleanup_partial ERR

pg_dump --format=custom --no-owner --no-privileges --dbname="${DB_NAME}" > "${target}"
chmod 0600 "${target}"

# A dump that pg_restore cannot list is not a valid backup.
pg_restore --list "${target}" >/dev/null

# Remove dumps older than the retention window.
find "${BACKUP_DIR}" -type f -name 'velismail-*.dump' -mtime +"${RETENTION_DAYS}" -delete

trap - ERR
echo "backup written: ${target} ($(du -h "${target}" | cut -f1))"
