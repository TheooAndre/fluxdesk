# Northflank Sandbox backend staging runbook

**Release:** FluxDesk v0.4, private preview only  
**Git source:** `TheooAndre/fluxdesk` on `feat/cloud-foundation-v0.4`  
**Status:** account owner confirmed Northflank account and GitHub setup.
No authenticated Northflank management connection is available to this ChatGPT
conversation, so **we have not created a project, service, volume or secret**.

Northflank's developer Sandbox includes two always-on free services, one
addon, and limited resources. Public documentation confirms volumes exist
but **does not establish a free persistent-volume allocation** for a particular
Sandbox account. Verify the amount/billing in the UI before provisioning.
Northflank requires a payment method even for free-tier resource creation.

Vendor documentation:
- https://northflank.com/pricing
- https://northflank.com/docs/v1/application/billing/pricing-on-northflank
- https://northflank.com/docs/v1/application/getting-started/link-your-git-account
- https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code
- https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume
- https://northflank.com/docs/v1/application/observe/configure-health-checks

## Gate 1: confirm free persistent volume before deploying

1. Sign in to `https://app.northflank.com/`, confirm **Developer Sandbox**
   on the team's Billing → Plans page. Do not select Pay as you go.
2. Verify the Git integration has access to *only* the
   `TheooAndre/fluxdesk` repository where feasible.
3. Choose **Create project**, name `fluxdesk-staging`, choose **EU West**
   (region is immutable), and keep it for sandbox/staging only.
4. Inspect **Create service → Combined service → Advanced → Volumes** or
   the project's available storage options, without launching a service.
5. Confirm whether the free plan can **create and attach** a *Single
   Read/Write* persistent volume at **container mount path `/data`**
   without a paid upgrade, with at least 1 GiB usable capacity preferred.
   Do not confuse the default ephemeral disk with a persistent volume.
   If the UI displays payment, disabled volume options, or insufficient
   resources, STOP and use our Oracle Cloud Always Free plan instead.
6. Do not enter secrets, enable paid features or launch the container before
   we confirm this gate. Send only the free/paid status and nonsecret
   project ID or URL back to the chat.

## Gate 2: backend combined service (only after Gate 1 passes)

- **Service:** `fluxdesk-api-staging`; type **Combined (build and run)**.
- **Repository:** `TheooAndre/fluxdesk`, branch
  `feat/cloud-foundation-v0.4`. **Do not select main**; main is v0.3.
- **Build method:** Dockerfile, path `/Dockerfile`, build context `/`.
- **Instances:** exactly 1, no autoscaling or separate replicas.
- **CPU/RAM:** selected free Sandbox allocation; do not upgrade.
- **Runtime environment values:**

  | Key | Value |
  | --- | --- |
  | `NODE_ENV` | `production` |
  | `HOST` | `0.0.0.0` |
  | `PORT` | `8787` |
  | `DATA_DIR` | `/data` |
  | `FLUXDESK_GATEWAY_TOKEN` | Random secret, 32+ bytes, provider-managed private runtime variable |

- **Storage:** attach the permitted *Single Read/Write* volume at `/data`.
  The backend **refuses to start** without an actual Linux mount at
  `DATA_DIR` when it listens on a public-interface host. We use this to
  prevent accidental loss of alerts and research archives on redeploy.
  The Docker image runs as `node:node`; Northflank uses the image's
  group to set volume ownership. Validate nonroot read/write in logs.
- **Networking:** public HTTPS port forwarding to container TCP/HTTP
  **8787**. A `*.code.run` domain with Northflank TLS is suitable.
  The port is accessible externally but **all backend routes require the
  private gateway token**; without it, `GET /api/health` returns **401**.
  Do not publish bare TCP 8787 through another router.
- **Health checks:** use a **TCP readiness probe** to container port
  **8787**, not an unauthenticated HTTP check, which would return 401
  and repeatedly restart a healthy API. The platform's command-probe
  option can also run an authenticated localhost health query, but the
  secret must never be echoed in logs.
- **Auto-deploy:** prefer **disabled** during initial acceptance; when
  enabled later, scope strictly to v0.4 branch and review migrations first.

To generate the private token on your own machine without posting it:
```bash
openssl rand -hex 32
```
Paste this value **only** into Northflank's environment variable editor,
and the Vercel preview project's server-side environment under the identical
name. Never put it into GitHub, `VITE_*`, screenshots or this chat.

## Gate 3: protected Vercel preview integration

Only after the staging service reports healthy and has a valid HTTPS URL:

1. In the existing Vercel project `fluxdesk`, keep Deployment Protection
   enabled for **all deployments** and verify in a signed-out browser.
2. Set preview-only environment variable `FLUXDESK_BACKEND_URL` to the
   Northflank backend URL including `https://` and trailing slash
   (no path, userinfo, query or fragment).
3. Set preview-only, **server-only** `FLUXDESK_GATEWAY_TOKEN` to the same
   private value you generated on your own machine.
4. Redeploy the **v0.4 branch preview only** so Functions receive the new
   environment variables. Do not promote production or share secrets.
5. Smoke test `/api/health` from the authenticated preview and compare
   with the direct Northflank endpoint:
    - Direct anonymous backend GET: **401**
    - Authenticated Vercel preview `/api/health`: **200** JSON, no secrets.
    - Foreign-origin POSTs: **blocked**.
6. Test Binance/Hyperliquid candles and backtest research; archive at least
   one dataset, restart the backend container, and confirm the same dataset ID
   and alert state survive. Follow with an offline/reconnect PWA iPhone test.
7. Export an encrypted backup and verify restoration to a separate test
   environment before treating historical research as durable.

## Stop conditions

- A plan upgrade or volume incurs nonzero charges without user approval.
- No writable single-instance persistent volume can be attached at `/data`.
- TLS or Deployment Protection is disabled, secret appears in logs, or
  unauthorized API request succeeds.
- Gateway mode starts without mounted persistence, or fails to survive a
  controlled restart.
- Sandbox compute is too small for stable WebSocket plus research operations.

In any stop case, keep Vercel public API disabled and choose OCI Always Free
(or a different persistent hosting option) rather than silently running the
stateful backend on ephemeral disk.

**Security boundary:** the Northflank Sandbox is for staging/testing, not
a reliable production home for personal trading research data. Backups remain
mandatory even when an attached volume works.
