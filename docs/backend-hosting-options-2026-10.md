# FluxDesk backend hosting options (22 October 2026)

## Why Railway provisioning is paused

This is **not** evidence Railway requires a paid plan for our account.
The official [Railway status page](https://status.railway.com/) currently
reports a **major incident** affecting builds/deployments. On 21 October 2026,
Railway [disclosed possible unauthorized access to stored environment
variables](https://blog.railway.com/p/security-disclosure-wednesday-october-21st).
The company recommends rotating exposed credentials. Its restoration plan
prioritizes Enterprise, Pro, Hobby, then Free/Trial. Our attempted creation
failed with `Deploys have been paused due to an upstream issue`; a subsequent
project listing showed **zero resources**.

**Security policy:** do not place FluxDesk gateway tokens or API keys in
Railway until the incident has been resolved and the account's security
state has been checked. No FluxDesk secrets or resources were provisioned.

## Non-negotiable application requirements

- One continuously running Node 22 backend, including outbound Binance
  and Hyperliquid HTTP/WebSocket connections (no sleeping/free idle spin-down).
- Writable persistent storage mounted at `DATA_DIR=/data` for
  `state.json` and `research/datasets/*.json`. Immutable candle digests
  are integrity checks, not backups.
- TLS-terminated HTTPS endpoint for the Vercel Function gateway, with
  `FLUXDESK_GATEWAY_TOKEN` held only in server-side secret managers.
- Restore-tested backups, logs, fixed single replica, and resource limits.
- Deployment isolated from the `main` branch until cloud acceptance.
- No exchange execution credentials or live order capability.

## Compared providers

| Host | Free continuous compute | Durable storage | Deployment fit |
| --- | --- | --- | --- |
| **Northflank Developer Sandbox** | Two free always-on services at limited resources | Owner's existing Default project offers a **6 GB NVMe volume at $0.15/GB/month ≈ $0.90/month** | **Selected for staging** with owner-approved storage charge only; stop if plan upgrade adds compute/egress charges |
| **Oracle OCI Always Free VM** | Up to the equivalent of 2 Ampere A1 OCPU and 12 GB RAM in the home region, subject to capacity | 200 GB combined boot/block volume limit | Best longer-lived $0 candidate if VM capacity and account verification permit; you manage OS, TLS, security, patching and backups |
| **Google Cloud Compute Engine** | One e2-micro in supported US regions | 30 GB standard persistent disk and 1 GB outbound transfer/month included | $0 option but only 0.5 GB RAM and US location; borderline for container build, websocket collector and periodic research |
| **Railway Free/Trial** | Trial: $5 one-time, 30 days; Free: $1 usage per month | Trial/Free max 0.5 GB volume | Nice managed hosting, but continuous usage may exceed free quota; active incident blocks provisioning |
| **Koyeb Free** | No, instance scales to zero after an hour idle | No persistent volumes on free | Unsuitable for always-on liquidation WebSocket and state |
| **Render Free** | No, free service spins down | No persistent disks on free; trial free Postgres expires | Unsuitable without paid instance and paid persistent disk |
| **Fly.io** | No standing free allowance for new accounts; metered always-on VM | Volumes billed separately | Low-cost paid fallback; inspect selected region/preset carefully |
| **Hetzner Cloud CX23** | Not free; Germany/Finland around €5.49/mo excl. VAT, IPv4 extra | Bundled disk plus optional backups | Cost-predictable paid VPS, fully self-managed |

**Sources (vendor documentation, checked 22 October 2026):**

- Railway: https://status.railway.com/,
  https://blog.railway.com/p/security-disclosure-wednesday-october-21st,
  https://docs.railway.com/pricing/plans
- Northflank: https://northflank.com/pricing,
  https://northflank.com/docs/v1/application/billing/pricing-on-northflank,
  https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume
- Oracle: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Google: https://docs.cloud.google.com/free/docs/free-cloud-features
- Koyeb: https://www.koyeb.com/docs/reference/instances
- Render: https://render.com/docs/free
- Fly.io: https://fly.io/pricing-update/
- Hetzner: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/

Pricing is region-, quota-, VAT- and date-dependent. Free-tier eligibility
isn't guaranteed until account creation, quota inspection and service testing.

## Selected staging decision (22 October 2026)

The owner initially selected Oracle Always Free, but found OCI infrastructure
management too complex and explicitly chose **Northflank** with an approved
estimated **$0.90/month** for its 6 GB NVMe persistent volume. The existing
account and `Default` project are available; no new project is necessary.
The owner supplied screenshots confirming the volume price and smallest
free service plan (0.1 shared vCPU, 256 MB RAM).

1. **Use Northflank Developer Sandbox** for exactly one staging service,
   one **Single Read/Write** volume, and HTTP/HTTPS on port 8787 through
   Northflank's TLS ingress. Attach the volume at `/data`. Detailed
   current UI walkthrough: [Northflank staging runbook](northflank-staging-v0.4.md).
2. **Cost guard:** The $0.90 figure covers **storage only**. If Northflank
   requires switching to Pay as you go, the smallest published `nf-compute-10`
   plan costs about **$2.70/month additional**, and network egress/taxes may
   also apply. Explicitly confirm the total with the owner before upgrading
   or agreeing to charges beyond the 6 GB volume.
3. **Keep OCI as a documented fallback only.** No OCI account/VM has been
   provisioned; its separate disk and Caddy deployment files remain in the
   repo for portability. There is no need to share Oracle passwords.
4. **Railway:** revisit only after the 21 October security incident closes
   and stored secrets have been reviewed.

## Portable Linux VPS deployment

The `deploy/vps/compose.yaml` and Caddyfile let us run the same Node
backend on OCI, Google Compute Engine or Hetzner without vendor coupling:

- Internal-only API port 8787 (no host port binding), private Docker network.
- Caddy handles public TCP 80/443 and obtains the public TLS certificate.
- `FLUXDESK_GATEWAY_TOKEN` must be 32+ random bytes and match the server-only
  environment variable in Vercel. The API rejects direct anonymous requests.
- Named volume `fluxdesk_backend_data` persists `/data` independently of
  container restarts. Scale must remain exactly one replica.
- Healthcheck authorizes a local `/api/health` request without exposing a
  public unauthenticated health route.
- `deploy/vps/backup.sh` produces 0600 archives of the volume. Encrypt an
  offsite copy and **test restore on another host** before calling storage safe.

No VM, DNS zone, certificates or secrets have yet been provisioned. The
user must approve any payment and connect the account for a chosen provider.

## Risk notes

Research API throughput is bounded, but large backtests remain synchronous
and can block the Node event loop. Never promise uptime for a sandbox plan.
The full cloud acceptance gate includes a real protected iPhone PWA, exchange
history fetch, reproducible backtest, offline shell and reconnection, and
backend data surviving an actual container restart.
