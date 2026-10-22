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
| **Northflank Developer Sandbox** | Yes; two always-on services, one addon, two cron jobs | Persistent volumes supported generally; verify **free-tier** quota and availability before selecting a plan | Simplest $0 preview candidate; vendor says free sandbox is **not for production** |
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

## Recommended staging decision

1. **Preferred short-term free preview:** Northflank Sandbox if the selected
   free plan supports a persistent volume for our single service. Its always-on
   compute is valuable, but do not make it the sole copy of important datasets.
   Connect GitHub, choose a European region if offered, enforce one replica,
   use its managed HTTPS ingress, mount persistent storage, and set the
   gateway secret in the provider's secret UI.
2. **Best ongoing $0 ownership option:** OCI Always Free Ampere A1 VM. Keep
   its CPU/memory/boot volumes within the **2026** Always Free thresholds
   (do not rely on old 4-OCPU/24-GB tutorials). Use the portable Compose/Caddy
   recipe in `deploy/vps`. Requires Oracle signup, quota and SSH administration.
3. **Fallback with minimal provider setup:** Fly.io or a small paid VPS
   if Oracle capacity isn't available and Northflank free volume quotas are
   insufficient.
4. **Railway:** revisit only after its security incident closes, tokens are
   safe to provision, and free usage is sufficient. No upgrades or paid
   resources without explicit user approval.

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
