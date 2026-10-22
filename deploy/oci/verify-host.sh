#!/usr/bin/env bash
# Non-destructive preflight for FluxDesk on an Oracle A1 (arm64) Ubuntu VM.
# It NEVER creates, partitions, formats or mounts a block device.
# Run only AFTER attaching and mounting a dedicated OCI block volume.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MOUNT="/srv/fluxdesk"
DATA="$MOUNT/data"
ENV_FILE="$ROOT/deploy/vps/.env"

fail() { printf 'OCI preflight FAILED: %s\n' "$*" >&2; exit 1; }
pass() { printf '[ok] %s\n' "$*"; }

[[ "$(uname -s)" == "Linux" ]] || fail "Run this on the Linux VM, not on the Mac"
[[ "$(uname -m)" == "aarch64" ]] || fail "Expected OCI Ampere A1 arm64 (aarch64)"
# shellcheck source=/dev/null
source /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "Use the audited Ubuntu A1 VM image"
pass "Ubuntu on OCI Arm64"

command -v findmnt >/dev/null || fail "findmnt is missing"
command -v mountpoint >/dev/null || fail "mountpoint is missing"
mountpoint -q "$MOUNT" || fail "$MOUNT is NOT a dedicated mounted disk"
findmnt --fstab --mountpoint "$MOUNT" >/dev/null ||
  fail "$MOUNT lacks a persistent /etc/fstab mount entry"
FS_TYPE="$(findmnt -rn --mountpoint "$MOUNT" -o FSTYPE)"
[[ "$FS_TYPE" == "ext4" || "$FS_TYPE" == "xfs" ]] ||
  fail "$MOUNT must be a supported ext4/xfs filesystem, got $FS_TYPE"
[[ -d "$DATA" ]] || fail "$DATA does not exist"
[[ "$(stat -c '%u:%g' "$DATA")" == "1000:1000" ]] ||
  fail "$DATA must be owned by node UID:GID 1000:1000"
pass "Mounted, reboot-persistent $FS_TYPE data disk with correct ownership"

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE; copy .env.example locally"
MODE="$(stat -c '%a' "$ENV_FILE")"
(( (8#$MODE & 0077) == 0 )) ||
  fail "Secrets file permits group/other access; run chmod 600 deploy/vps/.env"
TOKEN="$(sed -n 's/^FLUXDESK_GATEWAY_TOKEN=//p' "$ENV_FILE" | head -n 1)"
[[ "$TOKEN" =~ ^[[:xdigit:]]{64,}$ ]] ||
  fail "Generate a new 64-hex-digit gateway token with openssl rand -hex 32"
unset TOKEN
DOMAIN="$(sed -n 's/^FLUXDESK_BACKEND_DOMAIN=//p' "$ENV_FILE" | head -n 1)"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && "$DOMAIN" == *.* ]] ||
  fail "Set a DNS hostname without https:// or URL path"
[[ "$DOMAIN" != *.example ]] || fail "Replace example hostname with real DNS"
unset DOMAIN
VOLUME_ID="$(sed -n 's/^FLUXDESK_DATA_VOLUME_ID=//p' "$ENV_FILE" | head -n 1)"
[[ "$VOLUME_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] ||
  fail "Set FLUXDESK_DATA_VOLUME_ID to the UUID created on the OCI block disk"
[[ -f "$DATA/.fluxdesk-volume-id" ]] ||
  fail "Missing /data volume identity marker on attached disk"
ACTUAL_ID="$(cat "$DATA/.fluxdesk-volume-id")"
[[ "$ACTUAL_ID" == "$VOLUME_ID" ]] ||
  fail "OCI block disk marker does not match FLUXDESK_DATA_VOLUME_ID"
unset VOLUME_ID ACTUAL_ID
pass "Gateway secret, mounted-disk identity and private environment file validated (no values printed)"

command -v docker >/dev/null || fail "Docker Engine not installed"
sudo docker info >/dev/null || fail "Docker daemon is unavailable"
sudo docker compose version >/dev/null || fail "Docker Compose plugin not installed"
if sudo docker volume inspect fluxdesk_backend_data >/dev/null 2>&1; then
  DEVICE="$(sudo docker volume inspect -f '{{ index .Options "device" }}' fluxdesk_backend_data)"
  [[ "$DEVICE" == "$DATA" ]] ||
    fail "An existing volume is backed by '$DEVICE' instead of '$DATA'; STOP. Never replace it blindly"
fi
pass "Docker ready; no wrongly attached existing FluxDesk volume"

printf '\nPreflight passed. No disks formatted; no containers deployed.\n'
