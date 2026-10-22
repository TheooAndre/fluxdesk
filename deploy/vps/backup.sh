#!/usr/bin/env bash
# Snapshot the FluxDesk dataset and alert archive from an owner-managed VM.
# All backups contain sensitive alert/push-subscription metadata. Encrypt
# offsite copies and restrict local access. Restores must be performed offline.
set -euo pipefail
BASE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEST="${FLUXDESK_BACKUP_DIR:-$BASE/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="fluxdesk-backend-${STAMP}.tar.gz"

mkdir -p -- "$DEST"
chmod 700 -- "$DEST"
if ! docker volume inspect fluxdesk_backend_data >/dev/null 2>&1; then
  printf 'Missing volume fluxdesk_backend_data; no data to back up.\n' >&2
  exit 1
fi
# Container receives no application environment variables or credentials.
# State file writes use atomic rename and archived research snapshots are
# immutable, so a passive copy generally sees consistent individual files.
docker run --rm \
  --mount type=volume,src=fluxdesk_backend_data,dst=/source,readonly \
  --mount "type=bind,src=$DEST,dst=/backups" \
  -e BACKUP_FILE="$FILE" \
  -e BACKUP_UID="$(id -u)" -e BACKUP_GID="$(id -g)" \
  alpine:3.21 sh -ec '
    umask 077
    tar -czf "/backups/$BACKUP_FILE" -C /source .
    chown "$BACKUP_UID:$BACKUP_GID" "/backups/$BACKUP_FILE"
  '
tar -tzf "$DEST/$FILE" >/dev/null
chmod 600 -- "$DEST/$FILE"
printf 'Backup created and archive verified: %s\n' "$DEST/$FILE"
printf 'This is not a restore test. Keep an encrypted offsite copy.\n'
