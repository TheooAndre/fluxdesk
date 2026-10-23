#!/usr/bin/env bash
# Test the real backend against a durable Docker mount under Northflank's
# smallest free Sandbox resource cap: 0.1 vCPU and 256 MiB memory.
# No public ports, provider credentials, or cloud resources are involved.
set -euo pipefail

IMAGE="${1:-fluxdesk-api:ci}"
NAME="fluxdesk-ci-runtime-$$"
WORK="$(mktemp -d -t fluxdesk-runtime-XXXXXX)"
PORT="38787"
SECRET="$(openssl rand -hex 32)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  sudo rm -rf -- "$WORK"
}
trap cleanup EXIT

sudo chown 1000:1000 "$WORK"
start() {
  docker run -d --rm --name "$NAME" \
    --cpus="0.10" --memory="256m" \
    --mount "type=bind,src=$WORK,dst=/data" \
    -p "127.0.0.1:$PORT:8787" \
    -e FLUXDESK_GATEWAY_TOKEN="$SECRET" \
    "$IMAGE" >/dev/null
}
wait_for_api() {
  local status
  for _ in $(seq 1 90); do
    status="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' \
      "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
    if [[ "$status" == "401" ]]; then return 0; fi
    if ! docker inspect "$NAME" >/dev/null 2>&1; then
      echo "Backend container exited before readiness" >&2
      exit 1
    fi
    sleep 1
  done
  echo "Backend never answered 401 (unauthorized) within startup allowance" >&2
  docker logs --tail 30 "$NAME" >&2 || true
  exit 1
}

start
wait_for_api

status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' \
  -H "x-fluxdesk-gateway-token: $SECRET" \
  -H 'x-fluxdesk-public-host: fluxdesk-ci.example' \
  "http://127.0.0.1:$PORT/api/health")"
[[ "$status" == "200" ]] || { echo "Authorized health expected 200, got $status" >&2; exit 1; }

# Exercise a real persisted watchlist mutation through the authenticated API.
status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  -H "x-fluxdesk-gateway-token: $SECRET" \
  -H 'x-fluxdesk-public-host: fluxdesk-ci.example' \
  -H 'Origin: https://fluxdesk-ci.example' \
  -H 'Content-Type: application/json' --data '{"assetId":"binance:BTCUSDT"}' \
  "http://127.0.0.1:$PORT/api/watchlist")"
[[ "$status" == "200" ]] || { echo "Watchlist save expected 200, got $status" >&2; exit 1; }

# Exercise encrypted backup and isolated restore in the actual 256MiB image.
# This random CI-only password is never logged and never leaves /tmp.
docker exec "$NAME" node -e "require('node:fs').writeFileSync('/tmp/backup-password', require('node:crypto').randomBytes(32).toString('hex'), { mode: 0o600 })"
docker exec "$NAME" node --import tsx scripts/archive-cli.ts backup /data /tmp/ci.fdbackup --password-file /tmp/backup-password
docker exec "$NAME" node --import tsx scripts/archive-cli.ts verify /tmp/ci.fdbackup --password-file /tmp/backup-password
docker exec "$NAME" node --import tsx scripts/archive-cli.ts restore /tmp/ci.fdbackup /tmp/isolated-restore --password-file /tmp/backup-password
docker exec "$NAME" node -e "if (JSON.parse(require('node:fs').readFileSync('/tmp/isolated-restore/watchlist.json', 'utf8')).assetIds[0] !== 'binance:BTCUSDT') process.exit(1)"

# Write as the nonroot application user, rather than as the host/root.
docker exec "$NAME" node -e "require('node:fs').writeFileSync('/data/.ci-persistence-proof', 'preserved', { mode: 0o600 })"

docker rm -f "$NAME" >/dev/null
start
wait_for_api

docker exec "$NAME" node -e "
  const fs = require('node:fs');
  if (fs.readFileSync('/data/.ci-persistence-proof', 'utf8') !== 'preserved')
    process.exit(1);
"
curl -fsS --max-time 10 \
  -H "x-fluxdesk-gateway-token: $SECRET" \
  -H 'x-fluxdesk-public-host: fluxdesk-ci.example' \
  "http://127.0.0.1:$PORT/api/watchlist" | \
  node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{if(JSON.parse(s).assetIds[0]!=='binance:BTCUSDT')process.exit(1)})"
echo "PASS: encrypted backup/restore, gateway authentication, watchlist and mounted archive survived a container restart at 0.1 vCPU / 256MiB."
