> Release decision, 24 October: owner authorized retaining this existing service for production. Production configuration and the read-only Preview guard are documented in [production preflight](production-preflight.md); final alias/CI/merge receipts are in PR #12. Earlier instructions to keep PR #12 draft or deploy Preview only describe the initial staging acceptance phase and are superseded after the release gates pass. The service remains on the existing instance/volume with no compute upgrade. Freeze its backend branch until deliberately changing the provider Git configuration.

# FluxDesk v0.4: Northflank staging deployment

**Status (24 October 2026):** `fluxdesk-api-staging` is functional in the existing Default project. The owner verified remote dashboard / Strategy Lab data, faster refresh and archive persistence with the same dataset ID after a real service restart. The approved configuration remains one Sandbox instance (0.1 vCPU, 256 MB) plus a 6 GB `/data` volume, approximately $0.90/month for storage only.

The numbered instructions below are the setup runbook, not unfinished provisioning tasks. The owner completed encrypted export, matching computer download and isolated restore, and confirmed the scanner/journal workspaces working on iPhone. Final production-environment preflight/promotion remains separate; see the [development list](development-roadmap.md). No production promotion or paid compute upgrade has been authorized by this status update.

## 0. Billing gate: approval is for storage, not a paid-plan upgrade

Northflank currently publishes **$0.15/GB/month** for persistent storage.
The owner's chosen **6 GB volume costs approximately $0.90/month**,
before possible taxes, network egress, compute or plan charges. Northflank
Sandbox documents advertise **two free always-on services**, but the
pay-as-you-go price of its smallest `nf-compute-10` compute plan
(0.1 shared vCPU, 256 MB) is about **$2.70/month**. If the UI forces
an upgrade to Pay as you go, or the *total* expected recurring charge exceeds
the approved 6 GB volume price, **STOP and review the full bill before
agreeing to any additional charge**. Do not assume Sandbox allowances
carry over to the pay-as-you-go plan.

The Sandbox is for **testing**, not production reliability. Configure a
billing alert near your personal comfort level; an alert is not a hard cap.
Volumes remain billable even when paused or detached and cannot be shrunk.
Only the account owner can accept any billing terms.

Official vendor references:
- https://northflank.com/pricing
- https://northflank.com/docs/v1/application/billing/pricing-on-northflank
- https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume
- https://northflank.com/docs/v1/application/network/configure-ports
- https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code

## 1. Create persistent volume in existing Default project

In Northflank go to **Ety's Team → Default → Volumes → Create volume**.

| Setting | Value |
| --- | --- |
| Name | `fluxdesk-backend-data` (or existing planned name `FluxDesk Backend`) |
| Type | **Blank volume** |
| Storage type | **NVMe** |
| Storage size | **6 GB**; do not enlarge |
| Access mode, if available | **Single Read/Write (ReadWriteOnce)**, not shared |
| **Container mount path** | **`/data`** |
| Optional internal volume subpath | Empty; mount the volume root |
| Attach to resources | Select `fluxdesk-api-staging` if created; otherwise create unattached and attach afterward |

The screenshot's default path `/mydata` is **not suitable**.
Enable **Use custom volume mount paths** if needed, then enter `/data`.
The combined service's environment will set `DATA_DIR=/data`.

Northflank states that Single Read/Write is the default mode for a
single-pod workload; if the access-mode control is missing, confirm
the saved volume's mode in its details before attaching it.

If the **Attach to resources** list is empty because the service does not
yet exist, first try creating the volume unattached. If Northflank requires
a service to exist first, use step 2 to create the service with **Private
TCP port**, no externally accessible endpoint and no credential; startup
will intentionally fail until the volume and gateway secret are added.
Then attach the volume from either the service's Volumes page or the
project-level Volumes page. Attaching may redeploy the container.

Do not create a volume until the billing UI confirms its charges are
within the approved amount; stop on any paid-plan or extra-compute prompt.

## 2. Create one staging Combined service

Within **Default → Services → Create service → Combined**:

| Control | Value |
| --- | --- |
| Name | `fluxdesk-api-staging` |
| Git repository | `TheooAndre/fluxdesk` |
| Branch | **`feat/cloud-foundation-v0.4`**, never `main` |
| Build method | Dockerfile, BuildKit |
| Build context | `/` |
| Dockerfile | `/Dockerfile` |
| Build compute | Default BuildKit plan; do not buy upgrades |
| Runtime compute | **`nf-compute-10`** (0.1 shared vCPU, 256 MB) while free |
| Instances | Exactly **1**, no autoscaling |
| Ephemeral disk | Default 1 GB; **not** the archive |
| Runtime mode | Default Docker entrypoint and command |
| CI | Can stay enabled |
| Auto-deploy | Disable if controllable during acceptance, or pin to v0.4 branch |

The 256 MB plan is very small. CI includes a container smoke test under
**0.1 vCPU / 256 MB**, but production traffic and large backtests may
still exceed these resources. Watch memory and CPU graphs during staging.
If a higher compute plan requires charges, stop and review with the owner.

Set **Runtime variables** only (not build arguments):

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `8787` |
| `DATA_DIR` | `/data` |
| `FLUXDESK_GATEWAY_TOKEN` | A fresh random secret of at least 32 bytes |

Generate the private gateway token on your own Mac:

```bash
openssl rand -hex 32
```

Store it **only** in Northflank's private runtime-variable editor and,
later, Vercel's Preview-only environment. Never paste it into GitHub,
screenshots or chat; never use a `VITE_` prefix. It is not an API key
for exchange order execution. **Do not set**
`FLUXDESK_DATA_VOLUME_ID` in Northflank: that is an OCI-specific check.

The Docker image uses nonroot `node:node`. Northflank's volume typically
inherits the group from the image; if `Cloud data directory is not writable`
appears, verify mount ownership rather than running the service as root.
If `Persistent volume missing at DATA_DIR` appears, recheck the mount
path and attachment. Do not bypass the check.

## 3. Start privately, then expose only HTTPS

During initial service creation, leave port **8787 / TCP / Private** as shown
in the screenshots. This is NOT internet-accessible; that is safe while
verifying that the volume, process and private gateway token work.

**Health checks:** choose a **TCP readiness check on port 8787**. A generic
HTTP GET to `/api/health` without the gateway token correctly returns 401
and must not be used to mark the service unhealthy.

After the service is healthy and the shared gateway token is configured,
edit **Configure → Networking**, change the service's port 8787 from
**TCP / Private** to **HTTP / Public**. Northflank public ingress supports
HTTP/HTTP2, **not ordinary TCP**; it generates a `*.code.run` hostname
and terminates HTTPS automatically. Do not expose a raw TCP endpoint or
forward the local 8787 port outside Northflank's HTTPS ingress.

A direct unauthenticated request from your Mac should return:

```bash
curl -i https://YOUR-NORTHFLANK-HOSTNAME.code.run/api/health
# HTTP 401 JSON { "error": "Gateway authentication required" }
```

A direct 200 response without credentials is **a release-blocking security
failure**. Do not test the private secret using a public URL or copy it into
terminal commands that may enter shell history.

## 4. Connect the existing protected Vercel preview

In Vercel's **existing** `fluxdesk` project:

1. Keep **Vercel Authentication enabled for all deployments**; verify the
   preview is blocked in a private, signed-out browser.
2. Set **Preview-only** `FLUXDESK_BACKEND_URL` to the exact Northflank
   HTTPS origin, ending in `/` (for example,
   `https://my-service.code.run/`). No path, query or username.
3. Set **Preview-only** `FLUXDESK_GATEWAY_TOKEN` to the **same private**
   random value as the Northflank runtime secret.
4. Redeploy only the v0.4 Git branch **Preview**. Never deploy this feature
   branch as `production` or promote PR #12 to `main` yet.
5. From the authorized preview, `GET /api/health` must return JSON 200;
   direct anonymous Northflank requests must return 401.
6. Test market feeds, BTC historical fetch, research archive, backtest,
   equity/trade warnings, iPhone PWA offline shell and reconnection.
7. Restart the service and verify the **same dataset fingerprint** remains
   accessible. Export an encrypted offsite backup and test restore.
   Persistence across a restart is not equivalent to a disaster-recovery
   backup.

## Stop conditions

- Northflank requires a paid-plan upgrade or another recurring charge beyond
  the owner's **~$0.90/month** storage authorization.
- Memory/CPU limits, storage permissions or volume attachment prevent a
  healthy staging service.
- HTTP 200 is available on the Northflank backend **without** the gateway
  secret, or the Vercel preview is accessible while signed out.
- GitHub CI or Docker smoke tests fail; a research dataset disappears after
  restart; backup restoration fails.
- Owner sees any unexpected fee, credit-card verification problem or secret
  leakage.

**Scope:** This is a single-user read-only research dashboard. Do not add
exchange execution, auto-trading or other live money-moving endpoints.
