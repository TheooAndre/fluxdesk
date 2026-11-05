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
ACCOUNT_MODE=false

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
    -e FLUXDESK_ACCOUNT_AUTH="$ACCOUNT_MODE" \
    -e FLUXDESK_PUBLIC_HOST=fluxdesk-ci.example \
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

# No dashboard or /api/markets request: the real entrypoint must start collection.
# Health is a passive read, so increasing cycles prove it is independent of clients.
docker exec "$NAME" node --input-type=module -e "
  const health = async () => {
    const response = await fetch('http://127.0.0.1:8787/api/health', { headers: {
      'x-fluxdesk-gateway-token': process.env.FLUXDESK_GATEWAY_TOKEN,
      'x-fluxdesk-public-host': 'fluxdesk-ci.example',
    }});
    if (!response.ok) throw Error('Health failed: ' + response.status);
    return (await response.json()).markets;
  };
  const first = await health();
  if (!first.running || first.intervalMs !== 10000) throw Error('Market worker not started');
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const next = await health();
    if (next.completedCycles > first.completedCycles && next.lastStartedAt > first.lastStartedAt) {
      console.log('PASS: market collection advances without dashboard requests');
      process.exit(0);
    }
  }
  throw Error('Market worker stopped advancing');
"

# Exercise a real persisted watchlist mutation through the authenticated API.
status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  -H "x-fluxdesk-gateway-token: $SECRET" \
  -H 'x-fluxdesk-public-host: fluxdesk-ci.example' \
  -H 'Origin: https://fluxdesk-ci.example' \
  -H 'Content-Type: application/json' --data '{"assetId":"binance:BTCUSDT"}' \
  "http://127.0.0.1:$PORT/api/watchlist")"
[[ "$status" == "200" ]] || { echo "Watchlist save expected 200, got $status" >&2; exit 1; }

# Journal persistence uses the same authenticated API and durable volume.
docker exec "$NAME" node --import tsx --input-type=module -e "
  import {newTrade} from './src/journal/model.ts';
  const trade=newTrade('2026-10-24'); trade.title='CI journal persistence proof';
  const response=await fetch('http://127.0.0.1:8787/api/journal/trades',{method:'POST',headers:{'content-type':'application/json','x-fluxdesk-gateway-token':process.env.FLUXDESK_GATEWAY_TOKEN,'x-fluxdesk-public-host':'fluxdesk-ci.example',origin:'https://fluxdesk-ci.example'},body:JSON.stringify(trade)});
  if(response.status!==201)throw Error('Journal save failed: '+await response.text());
"

# Exercise encrypted backup and isolated restore in the actual 256MiB image.
# This random CI-only password is never logged and never leaves /tmp.
docker exec "$NAME" node -e "require('node:fs').writeFileSync('/tmp/backup-password', require('node:crypto').randomBytes(32).toString('hex'), { mode: 0o600 })"
docker exec "$NAME" node --import tsx scripts/archive-cli.ts backup /data /tmp/ci.fdbackup --password-file /tmp/backup-password --require-journal
docker exec "$NAME" node --import tsx scripts/archive-cli.ts verify /tmp/ci.fdbackup --password-file /tmp/backup-password --require-journal
docker exec "$NAME" node --import tsx scripts/archive-cli.ts restore /tmp/ci.fdbackup /tmp/isolated-restore --password-file /tmp/backup-password --require-journal
docker exec "$NAME" node -e "if (JSON.parse(require('node:fs').readFileSync('/tmp/isolated-restore/watchlist.json', 'utf8')).assetIds[0] !== 'binance:BTCUSDT') process.exit(1)"

docker exec "$NAME" node -e "if (JSON.parse(require('node:fs').readFileSync('/tmp/isolated-restore/journal.json', 'utf8')).trades[0].title !== 'CI journal persistence proof') process.exit(1)"

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
curl -fsS --max-time 10 \
  -H "x-fluxdesk-gateway-token: $SECRET" \
  -H 'x-fluxdesk-public-host: fluxdesk-ci.example' \
  "http://127.0.0.1:$PORT/api/journal" | \
  node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{if(JSON.parse(s).trades[0].title!=='CI journal persistence proof')process.exit(1)})"
echo "PASS: encrypted backup/restore, gateway authentication, watchlist, journal and mounted archive survived a container restart at 0.1 vCPU / 256MiB."

# Upgrade the same artificial persisted volume to account isolation. No hosted
# records or real credentials are used. This also checks the memory/CPU budget.
docker rm -f "$NAME" >/dev/null
ACCOUNT_MODE=true
start
wait_for_api
docker exec -i "$NAME" node --import tsx --input-type=module <<'JS'
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {ownerSetupProof,ACCOUNT_COOKIE} from './server/account-policy.ts';
const host='fluxdesk-ci.example';
const password=randomBytes(24).toString('base64url');
const headers={'x-fluxdesk-gateway-token':process.env.FLUXDESK_GATEWAY_TOKEN,
  'x-fluxdesk-public-host':host,'x-fluxdesk-client-ip':'192.0.2.1',origin:'https://'+host,'content-type':'application/json'};
async function call(path,data,cookie='',setup=false){
  const method=data?'POST':'GET';
  return fetch('http://127.0.0.1:8787/api/'+path,{method,headers:{...headers,...(cookie?{cookie}:{}),
    ...(setup?{'x-fluxdesk-owner-setup':ownerSetupProof(host,'/api/'+path,method)}:{})},
    ...(data?{body:JSON.stringify(data)}:{})});
}
const denied=await call('watchlist');
if(denied.status!==401)throw Error('Anonymous account data was not denied');
const owner=await call('auth/register-owner',{name:'CI owner',email:'owner@example.test',password},'',true);
if(!owner.ok)throw Error('Owner setup failed: '+owner.status);
const ownerCookie=owner.headers.getSetCookie().find(x=>x.startsWith(ACCOUNT_COOKIE+'=')).split(';')[0];
const watch=await (await call('watchlist',null,ownerCookie)).json();
if(watch.assetIds[0]!=='binance:BTCUSDT')throw Error('Legacy owner mapping failed');
const journal=await (await call('journal',null,ownerCookie)).json();
if(journal.trades[0].title!=='CI journal persistence proof')throw Error('Legacy journal mapping failed');
const friend=await call('auth/register',{name:'CI friend',email:'friend@example.test',password});
if(!friend.ok)throw Error('Friend registration failed: '+friend.status);
const friendCookie=friend.headers.getSetCookie().find(x=>x.startsWith(ACCOUNT_COOKIE+'=')).split(';')[0];
const isolated=await (await call('watchlist',null,friendCookie)).json();
if(isolated.assetIds.length)throw Error('Friend can read owner data');
const friendJournal=await (await call('journal',null,friendCookie)).json();
if(friendJournal.trades.length)throw Error('Friend can read owner journal');
await writeFile('/data/.ci-account-password',password,{mode:0o600});
console.log('PASS: owner registration, legacy mapping and friend isolation at 0.1 vCPU / 256MiB');
JS

docker exec "$NAME" node -e "require('node:fs').writeFileSync('/tmp/backup-password', require('node:crypto').randomBytes(32).toString('hex'), { mode: 0o600 })"
docker exec "$NAME" node --import tsx scripts/archive-cli.ts backup /data /tmp/accounts.fdbackup --password-file /tmp/backup-password --require-journal
docker exec "$NAME" node --import tsx scripts/archive-cli.ts verify /tmp/accounts.fdbackup --password-file /tmp/backup-password --require-journal
docker exec "$NAME" node --import tsx scripts/archive-cli.ts restore /tmp/accounts.fdbackup /tmp/account-restore --password-file /tmp/backup-password --require-journal
docker exec "$NAME" node -e "if(!require('node:fs').existsSync('/tmp/account-restore/accounts.sqlite'))process.exit(1)"
docker rm -f "$NAME" >/dev/null
start
wait_for_api
docker exec -i "$NAME" node --import tsx --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {ACCOUNT_COOKIE} from './server/account-policy.ts';
const host='fluxdesk-ci.example';
const headers={'x-fluxdesk-gateway-token':process.env.FLUXDESK_GATEWAY_TOKEN,
  'x-fluxdesk-public-host':host,'x-fluxdesk-client-ip':'192.0.2.2',origin:'https://'+host,'content-type':'application/json'};
const response=await fetch('http://127.0.0.1:8787/api/auth/login',{method:'POST',headers,
  body:JSON.stringify({email:'owner@example.test',password:await readFile('/data/.ci-account-password','utf8')})});
if(!response.ok)throw Error('Account login did not survive container restart');
const cookie=response.headers.getSetCookie().find(x=>x.startsWith(ACCOUNT_COOKIE+'=')).split(';')[0];
const status=await fetch('http://127.0.0.1:8787/api/auth/session',{headers:{...headers,cookie}}).then(r=>r.json());
if(!status.authenticated||!status.owner)throw Error('Persisted owner identity failed');
console.log('PASS: account credentials, owner identity and encrypted account backup survive restart');
JS
