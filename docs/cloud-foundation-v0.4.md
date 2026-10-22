# FluxDesk v0.4 Cloud Foundation (draft)

## Provisioning status (22 October 2026)

- Vercel project `fluxdesk` is connected to GitHub
  `TheooAndre/fluxdesk`; the feature branch produces automatic **preview**
  builds. The verified preview is commit `34b8fc2`. The project has Vercel
  Authentication enabled on **all** deployments.
- Vercel reports `live: false`. An early deployment erroneously classified as
  production was canceled. No production dashboard or backend is live.
- The protected preview passed GitHub CI #227 but our automated protected-URL
  fetch is denied with HTTP 403 due to current deployment-access permissions.
  We have not verified live cloud API routes end to end.
- Railway is connected but project creation returned
  `Deploys have been paused due to an upstream issue`. Inspection confirmed
  zero Railway projects, services and volumes provisioned. Railway's
  21 October 2026 security disclosure reported possible unauthorized access
  to encrypted/decrypted environment variables; **do not store gateway
  secrets there until the incident is closed and account security is reviewed**.
- The owner has since selected **Northflank** for staging because its
  service interface is simpler than managing OCI. The owner approved
  **approximately $0.90/month for a 6 GB NVMe volume only**; this is not
  approval for a paid compute plan, plan upgrade, egress charges or other
  billable resources. Use the existing Northflank `Default` project,
  Single Read/Write `/data` storage, one Sandbox instance and the
  `feat/cloud-foundation-v0.4` branch. See the
  [Northflank staging runbook](northflank-staging-v0.4.md).
- Oracle remains a **prepared, unused fallback**. No OCI account or VM was
  provisioned. Its A1 Arm64 plus separate disk configuration remains
  documented in case we need to migrate.
- The portable VPS configuration at `deploy/vps/` supports Oracle Always
  Free, Google Compute Engine and conventional VPS hosts (single Node API,
  Docker volume, Caddy-managed TLS, local encrypted/offsite backup process).
  **The OCI overlay** `deploy/oci/compose.oci.yaml` binds the archive volume
  to a separate `/srv/fluxdesk` disk. `deploy/oci/verify-host.sh` fails
  closed on missing mount, incorrect ownership, unsafe secrets or mismatched
  Docker volume. Exact account, VM, firewall, disk and setup instructions:
  [OCI staging runbook](oci-always-free-v0.4.md).
- See [22 October hosting comparison](backend-hosting-options-2026-10.md)
  for a verified 2026 free-tier matrix and recommended providers. No cloud
  VM, service, private gateway token or persistent disk has been deployed yet.

## Scope and release gates

The intended architecture has **two distinct services**:

1. **Vercel** serves the Vite/React PWA and its small same-origin
   `/api/*` gateway function. Protect **all deployments** with Vercel
   Authentication before sharing any URL, including the production domain.
2. **Persistent Node API** runs continuously in a single non-root container
   with a durable `/data` volume and HTTPS ingress. It owns WebSocket
   liquidation collection, scheduled alerts, local alert state, and
   SHA-256 historical-candle datasets.

Vercel Functions are not a replacement for the always-running market-data
collector. The Vercel gateway verifies browser mutation origins, reads its
server-only gateway credential, and forwards to an explicitly configured HTTPS
backend. The Node process independently authenticates that credential using
a constant-time comparison. No API keys, bearer tokens or cloud secrets are
bundled into client-side JavaScript.

### SECURITY: No public FluxDesk until ALL checks pass

- [ ] Vercel project has **Vercel Authentication → All Deployments**
  enabled (including production domains); verify in a private browser.
- [ ] Vercel environment has `FLUXDESK_BACKEND_URL` (publicly reachable
  HTTPS URL of the persistent API), set as server-side runtime environment.
- [ ] Vercel has `FLUXDESK_GATEWAY_TOKEN`, a randomly generated secret of
  **at least 32 bytes** stored as an encrypted/sensitive server environment
  variable. **NEVER** prefix it `VITE_`, commit it, or paste it into chat.
- [ ] Persistent Node host has that same `FLUXDESK_GATEWAY_TOKEN` in its
  provider-managed environment and `HOST=0.0.0.0`, `PORT=8787`.
- [ ] Persistent Node host has a **durable and writable** `DATA_DIR=/data`.
  Backups for `state.json` and `research/datasets/` are configured and
  restore-tested. Replicas must remain at **one** until DB migration.
- [ ] Backend ingress is HTTPS-only (e.g., provider managed TLS), rate
  limited and monitored. Do not assume an obscure URL provides security.
- [ ] External unauthenticated request to backend `/api/health` returns
  **401**, not private data. Public routes must also require the gateway.
- [ ] Test that foreign-origin browser POSTs fail with **403** at Vercel.
- [ ] Test an authorized `/api/health` succeeds through Vercel, and
  a full research fetch → archive → backtest cycle works.
- [ ] Verify that fresh and offline iPhone PWA launches behave correctly
  under the protected origin and do not cache API data.
- [ ] GitHub CI, Lighthouse, audit and deployment approval checks pass.

If `FLUXDESK_BACKEND_URL` or the credential is missing, requests to
`/api/*` return a non-cacheable **503**, by design. The Vercel frontend
may render an offline/unavailable status but must not claim live market data.

The optional existing `REVERSE_PROXY_OIDC=true` deployment path remains
supported for independently authenticated self-hosting. Do not turn it on
unless a **verified** OIDC reverse proxy is actually deployed.

## Cloud data and runtime model

The API stores alert rules, events, push subscriptions, and datasets on the
filesystem. A Vercel Function's ephemeral filesystem is **not** suitable.
Attach a persistent provider-managed volume to the Node container at
`/data`. Until durable SQL and a distributed job queue are implemented,
run exactly one API replica. Avoid automatic horizontal scaling, rolling
instances that mount separate volumes, or deployments that discard `/data`.

Existing backtests are synchronous and bounded to 3,000 candles via HTTP.
Longer archives are available to the CLI, not the browser. No order execution,
leverage, exchange API keys, or auto-trading are enabled.

## Self-managed VPS option (OCI / Google / Hetzner)

An owner-managed Linux VM can run the same service without platform coupling.
Install Docker Engine and Compose, create a DNS A/AAAA record to the VM,
permit only SSH from known addresses plus TCP 80/443 for Caddy, and disable
direct exposure of TCP 8787. On the VM:

```sh
git clone https://github.com/TheooAndre/fluxdesk.git
cd fluxdesk
git fetch origin
git switch --track origin/feat/cloud-foundation-v0.4
cp deploy/vps/.env.example deploy/vps/.env
chmod 600 deploy/vps/.env
# Edit the env file locally: set actual DNS hostname and 32+ random byte token.
# Never paste the filled file or the token into ChatGPT/GitHub.
docker compose --env-file deploy/vps/.env -f deploy/vps/compose.yaml config
docker compose --env-file deploy/vps/.env -f deploy/vps/compose.yaml up -d --build
```

The compose file has two services: an internal API (port 8787 **not published**)
and Caddy listening on public 80/443. A named Docker volume persists the alerts,
subscriptions and datasets. The container has a healthcheck that authenticates
to the private API. Caddy obtains TLS certificates automatically once DNS
and reachability are correct. Provision a minimum 1 GB of available RAM and
additional swap/disk for builds; the CI tests do **not** validate a particular
host VM's actual memory and network restrictions.

The backup script is manual until a host scheduler is configured:

```sh
bash deploy/vps/backup.sh
```

It creates a restrictive local archive of the Docker volume, **not a
validated offsite backup**. Copy the archive to separately encrypted storage,
add a retention policy and restore test with the API stopped. Keep the volume
as the only live writer and do not run multiple app replicas.

## Operational deployment sequence

1. Merge only reviewed and fully CI-tested cloud foundation changes.
2. Provision an appropriately sized persistent single-instance Node host and
   securely attach a durable `/data` volume. Configure TLS.
3. Put the shared gateway secret into the hosting provider's **secret UI**,
   not the repository. Set `HOST=0.0.0.0` and `DATA_DIR=/data`.
4. Deploy the container and verify an unauthenticated remote health request
   responds with 401. A provider TCP probe or authorized gateway probe can be
   used for health checking.
5. Configure the protected Vercel project. Set the HTTPS backend origin and
   the matching gateway secret in Vercel's server-only environment.
6. Use the Vercel preview URL first. Check market-data availability, mutation
   origins, alerts, archived datasets and iPhone offline/reconnect behavior.
7. Promote reviewed production builds only after GitHub quality gates and
   hosted end-to-end checks pass.

For convenience, the container entrypoint is:
```sh
docker build -t fluxdesk-api .
docker run --rm --name fluxdesk-api \
  -e HOST=0.0.0.0 -e PORT=8787 -e DATA_DIR=/data \
  -e FLUXDESK_GATEWAY_TOKEN \
  -v fluxdesk-research:/data -p 127.0.0.1:8787:8787 \
  fluxdesk-api
```
**This command binds the container only to the Mac's loopback interface.**
To provide real external access, first deploy an HTTPS ingress backed by a
managed container service with persistent disk; do not change the port mapping
to `0.0.0.0` without a configured secure ingress.

Keep the old Mac/iPhone LAN preview available until cloud acceptance passes.

## Dependency and deployment notes

- Vercel Authentication must be applied to **all** deployments through the
  Vercel project security settings. A `vercel.json` rewrite alone is not an
  authentication system.
- A Vercel Authentication session does **not** authenticate direct calls to
  the separate API host. The gateway uses an independent strong server-held
  credential for that purpose.
- Vercel's SPA fallback routes deep links to `/index.html`; API function
  routes must remain separate from this fallback.
- No `VITE_*` environment variable is used for cloud API credentials.
- Keep preview and production environment secrets separate when multiple
  backend instances are used, so preview cannot change production research
  state. A shared backend should be considered a temporary, risky shortcut.
- This milestone's deployment configuration is **not** an authorization to
  activate order placement or claim strategy profitability.
