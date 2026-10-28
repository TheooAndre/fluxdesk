# FluxDesk v0.4: Cloud Terminal, Stat-arb Scanner + Trade Journal

A **read-only**, self-hosted trading research dashboard. Native iOS app packaging is not required: it is an installable React/Vite progressive web app, with an optional server-side Web Push service. **No exchange API keys or trade execution are used.**

> Scope: personal single-user research dashboard, not a validated alpha engine. The four trading models are deterministic **candidates** and must be properly backtested before relying on them. It is deliberately not a financial-advice product.

## v0.4 release — 24 October 2026

Protected Vercel PWA with the existing persistent Northflank service, a venue-wide cointegration discovery scanner and a dated crypto trade journal. Owner-reported iPhone acceptance covers scanner/journal, open positions, reviews and analytics. Production configuration uses the existing service and volume, without new compute. New Preview gateways are read-only; production keeps normal saves. See [production preflight](docs/production-preflight.md) and [PR #12](https://github.com/TheooAndre/fluxdesk/pull/12) for the release build, CI and canonical-alias evidence. Research-data validation remains separate from hosting readiness.

## v0.3 release — 22 October 2026

FluxDesk v0.3 introduces an explicitly **research-only Strategy Lab** without any
exchange order placement or prediction claims. It supports:

- Fetching and validating completed Binance/Hyperliquid futures candles, with
  strict gap/duplicate/overlap rejection and checksummed local archives.
- Replaying four rule-based signal candidates with next-bar entries,
  conservative intrabar stop/target ordering and configurable fee/slippage
  assumptions.
- Chronological development/holdout summaries, closed-trade equity curves,
  individual trade logs and prominent disclosures.
- An iPhone-friendly, lazy-loaded Strategy Lab module that remains available
  within the installed PWA's precached shell.
- Bounded HTTP research operations and CLI archive/replay workflows.
- A Host-preserving local HTTPS proxy that allows same-origin mutations
  from iPhone without weakening server-side origin checks.

**Release acceptance:** GitHub CI #188 passed all stages. On 22 October 2026,
the application owner confirmed all seven local iPhone acceptance checks,
including historical BTC download, saved datasets, backtesting, reports, PWA
offline launch and reconnection recovery. See
[the v0.3 release record](docs/release-v0.3.md) for precise scope, test evidence
and remaining research/deployment limitations.

**Do not expose the local API to the public internet.** Personal LAN preview
is not authenticated cloud hosting. Production remote access still requires
HTTPS, a verified OIDC reverse proxy and durable persistence planning.

## v0.2 continuation — 19 October 2026

This release continues the existing React/TypeScript/Node dashboard. It does not replace the separate Python stat-arb research engine.

- Fixed the asset-switching runtime/TypeScript error and the service-worker TypeScript error; added the missing `workbox-window` dependency. A reproducible dependency lockfile is now included.
- Added per-exchange feed status, original snapshot age, explicit regional/rate-limit errors, and a recovery action when the selected venue is unavailable. Retained market snapshots expire after 15 minutes; stale snapshots never feed price alerts or correlation-universe discovery.
- Added strict OHLCV, duplicate/gap, completion and freshness checks. Failed candle refreshes do not fall back to stale history. Hyperliquid monthly boundaries follow its returned timestamps; Binance monthly boundaries use UTC calendar months.
- Added separate scan failure/insufficient-history details, both direction and model filters, and market-table pagination. Missing OI sorts after known OI in either direction. Correlation results disclose how many comparisons actually succeeded.
- Corrected the displayed OLS beta to the prior-bar fit that produced the latest z-score; non-OU AR estimates no longer produce a misleading half-life. Fixed the two earliest confirmed MSB pivots being skipped and clarified EMA rule descriptions. No parameter search or new profitability claim was introduced.
- Unknown/disconnected liquidations display **Unavailable**, including Hyperliquid market-wide coverage. A connected Binance stream reports whether a full observation window has elapsed.
- Added cancellation/timeouts for read requests, bounded in-flight request deduplication, read-only HTTP integration tests, and method/input checks.
- Kept offline app-shell support. Market APIs now require the network, and alert creation is not silently queued for later execution.

See `VALIDATION_REPORT.md` for measured checks and remaining release gates. The archive includes both source and a built `dist/` app; Node dependencies still need installation.

## Architecture decision record (ADR-001)

- **Vite + React + strict TypeScript**: a client-heavy terminal that does not require SEO/SSR. Keeps the iPhone app installable and compact. TanStack Query handles server refresh and caching; Zustand manages UI filters.
- **Tailwind / design-token theme**: responsive dark UI with meaningful labels, keyboard support and reduced-motion handling. SVG charts avoid heavyweight chart dependencies.
- **Node 22 native HTTP + fetch/WebSocket aggregator**: a single small backend prevents browser CORS issues, stores source secrets securely, and gathers exchange liquidations even when iPhone Safari is closed. There is deliberately no brokerage API-key or exchange order-placement flow.
- **JSON persistence with atomic write**: sufficient for a **single process / personal server**. This is *not* a horizontally scalable PostgreSQL system; moving to multi-user or multi-instance deployment requires authenticated user data separation, PostgreSQL and a durable job queue.
- **Workbox (injectManifest)**: precached offline shell and assets, update prompt, network-only market/alert APIs. Clients opt in to push notifications explicitly. Previously visible in-memory data can remain on screen with an offline warning; it is not a new quote.
- **OIDC boundary**: production self-hosting *must* be protected by an existing OIDC-aware reverse proxy (for example oauth2-proxy + an identity provider) and HTTPS. Do not expose the Node server directly. This repo is intentionally single-user and does not implement homemade login.

## Implemented

- Binance USDT-margined **perpetuals**: 24h prices/returns and USDT notional volume; current OI for an inspected contract.
- Hyperliquid default perp DEX: current mark price, prior-day comparison, 24h notional volume and current OI in USD (base-denominated interest × mark price).
- Switch selected comparison benchmark among BTC / ETH / SOL / HYPE / **gold** (Binance `XAUUSDT` perp, when listed/available in the current API response). 24h relative % returns are multiplicative, not subtraction.
- Sort by reported volume (high-to-low / low-to-high), relative returns and **available** OI. Binance OI for unselected contracts is not batch-available: those rows show “Select ↗” rather than imaginary values. This means an OI rank across *all* Binance assets is not currently exhaustive.
- Current OI ratio of selected asset to selected major, comparing same-venue instruments first and labeling cross-venue comparisons as approximate.
- Historical candlesticks on every exchange-supported timeframe (15 Binance, 14 Hyperliquid); 40-bar high/low + 1 ATR price levels. Visualize observed historical forced-liquidation price clusters (0.25% bins, 60-minute window). **Not future liquidation heatmap estimates.**
- Correlation scanner: top 28 liquid same-venue markets (minimum $1m reported daily notional). Pearson *log-return* correlation on 1h/other selected aligned and completed bars. r ≥ **0.87** threshold. Then selected log-spread z-score with an 80-bar rolling OLS hedge coefficient fitted on *prior bars*, not on future prices. We do not infer cointegration from correlation alone.
- All-timeframe, on-demand long+short scanner, reporting both detected candidates and unavailable intervals. Four rule-based entry detectors on the last **fully closed candle**, no repainting of future pivots: (1) 20-bar swing-failure wick and recovery, (2) close through a confirmed 2-left/2-right swing pivot, (3) EMA20/50 trend continuation pullback, (4) compressed 20-bar range edge rejection. Display possible direction, trigger reference, invalidation level and 2R illustration. Their predictive edge **has not been established**.
- Alerts on last price crossing a level, fully closed 5m volume exceeding previous 20 candles by x%, and Binance **observed** forced order snapshots totaling ≥ $N over 5 minutes. Client notifications require VAPID configuration and opt-in. Server polls market alerts every minute; thresholds have a 5-minute cooldown. Price triggers use threshold crossings, not persistent beyond-level states; volume alerts emit at most once per completed candle.
- Economic calendar reads the keyless Finance Calendar API for high-impact US releases with exact UTC times over a rolling two-week window. It displays source links, estimated/stale labels and provider attribution. Coverage is selective and consensus is usually unavailable; provider failures are explicit, never filled with a fabricated schedule.
- iOS PWA installation help and push opt-in. Apple Web Push requires a supported iOS version and installation to Home Screen; permission must come from a user gesture.

## Data integrity warnings

The persistent Node API refreshes market overview snapshots every **10 seconds**,
even with no open dashboard or enabled alerts. The browser also polls in hidden
tabs while its timers run, with immediate refresh on return/reconnection and a
**Refresh** button. The backend reuses each venue's successful quote snapshot
for at most **5 seconds** before the next request can refresh it, and coalesces
concurrent browser, background-worker and alert requests.
This is a polling target, not a latency guarantee: exchange response time,
network delays and rate-limit backoff can make data older. Existing snapshot
timestamps and stale/unavailable labels remain authoritative; a failed fetch
never resets the last-success time. Browser/phone suspension pauses client
updates, but server collection continues while the backend is running. The
authenticated health endpoint exposes worker cycles and actual venue ages
without triggering a refresh. Quotes are a latest snapshot, not a new historical
archive. This does not change candle caching, alert cadence or research rules.

1. **Binance `!forceOrder@arr` is a sampled stream**, at most one liquidation order snapshot per symbol per second. Sum of observed snapshots **is not the true total liquidations** (events may be missed and snapshots are not a unique liquidation ledger). The app correctly labels it partial. Public Hyperliquid all-account liquidation notional is **not** implemented; per-user liquidation/fill events do not imply a complete market-wide liquidation stream.
2. Liquidation *future levels* are not observable from OHLCV and OI alone. The app instead shows transparent support/resistance and historical observed liquidation execution prices. Forward liquidation estimates require an appropriately licensed vendor, a venue-specific on-chain reconstruction, or a documented estimation model with large uncertainty.
3. Hyperliquid perp data is USDC-collateralized / quoted; Binance uses USDT. The UI shows USD-equivalent **approximations**, not a guaranteed stablecoin FX-adjusted notional. Funding, basis, quote conventions and contract types vary.
4. Gold here is **XAUUSDT perpetual**, not spot bullion or an independent XAUUSD economic time series. It may not be offered in your region.
5. Exchange connector API calls can fail because of regional geoblocking, upstream rate limits, or downtime. The server caches recent values briefly; stale values must not be interpreted as real-time quotes. Correlation scanning makes up to 29 historical candle requests, so use it responsibly.
6. The system does not claim a profitable pattern, cointegrated pair, high-probability setup or backtested strategy. There is no live execution, fill simulator or drawdown-based automated trading.

## Local setup

Prerequisites: Node 22.12+ LTS or Node 24 LTS, pnpm 10.18.0. From repository root:

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm dev
```

The Node service automatically loads an optional `.env` file through the Node 22 runtime. Production environment variables supplied by the host take precedence. Open `http://127.0.0.1:5173`. The Vite dev server proxies `/api` to `127.0.0.1:8787`. **Real exchange internet access is needed.** If the data feed fails, the app shows an error rather than fake numbers.

For a production-like build:

```bash
pnpm test && pnpm typecheck && pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. Use HTTPS + verified OIDC proxy before exposing externally. Create production icons in `public/icons/` already included. Static app assets are served by Node with immutable hashed asset caching.

**Environment variables** (all server-side, never `VITE_`):

| Variable | Meaning |
| --- | --- |
| `HOST`, `PORT` | API bind interface and port; default `127.0.0.1:8787` |
| `DATA_DIR` | Alert and PushSubscription JSON storage directory, writable and backed up |
| `REVERSE_PROXY_OIDC` | Must be `true` for an intentional non-local bind, only after deploying a real authentication proxy |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional Web Push credentials; e.g. `mailto:you@yourdomain.tld` |

Generate VAPID keys with a local package command after installing dependencies: `pnpm exec web-push generate-vapid-keys`. Keep private key secret. Never set `REVERSE_PROXY_OIDC=true` as a shortcut to open network access.

## PWA / iOS gotchas

- Safari on iOS requires **Share → Add to Home Screen**. Some PWA install / Web Push behavior differs from desktop Chrome; test on physical iPhone over HTTPS.
- Service worker is only fully active in `pnpm build` + real-origin deployment, not the ordinary Vite dev experience. The app prompts for a new version; it does **not** auto-activate a new service worker during an active view.
- Alert creation requires connectivity and server acknowledgment. v0.2 removes background replay of alert-creation requests. An offline or failed request is not an active alert; check the Active rules list after reconnecting.
- Alerts are evaluated **on the running Node server**, not on the iPhone. To get notifications while the app is closed, keep the backend online, register push from an installed iPhone, and provide an OIDC-protected HTTPS hostname. Delivery is best-effort, not guaranteed.
- For a packaged native iOS app, APNs is a different integration not included here.

## Multi-timeframe signal scanning

The **Entry models** tab automatically scans the selected contract on **all native candle intervals** and reports candidates in either direction. Binance intervals are `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M`; Hyperliquid supports the same set without `6h`. The scanner is on demand and bounded to four concurrent historical candle requests per selected asset. Every signal uses the final completed exchange candle; if an interval fails it is explicitly reported. Scans are not continuous multi-asset monitoring or push signals. Choosing a candidate opens its timeframe in the detailed model view. Completion uses exchange-provided candle close times. Binance month continuity is calendar-based; Hyperliquid monthly continuity follows adjacent reported close/open boundaries. Missing history is reported, not filled.

## Signal mathematics

Let `x_t = log(P_A,t)` and `y_t = log(P_B,t)` for **aligned completed bars**. Rolling OLS on previous W=80 bars estimates `β` and intercept. Current residual = `x_t − α_(t−1) − β_(t−1)y_t`; displayed `z_t` standardizes by the *previous* residual sample mean/standard deviation. Scanner correlation uses Pearson r of aligned log returns with sample length ≥ 30. A positive (negative) spread z-score only means above (below) rolling historical residual; it **does not** by itself imply a short (long) edge. Engle-Granger/ADF, half-life stability, walk-forward cost-aware OOS research and a preregistered hypothesis remain necessary.

Entry models intentionally share **fixed illustrative** parameter defaults; avoid optimizing these in-sample without a separate untouched OOS holdout. SFP uses prior 20-bar extremes; MSB uses pivots *confirmed* with two right-hand bars; pullback uses EMA20 vs EMA50 and a close back across EMA20; chop rejects range edges under low range width/trend slope. Each candidate uses structural/ATR invalidation and illustrative target at 2R from latest close. No order fill is assumed.

## Testing, performance and release gate

- `pnpm test`: Vitest deterministic algebra/indicator/bias checks. A dependency-free sanity run is available via `node --experimental-strip-types --test tests/smoke.node.mjs` on Node 22.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: code hygiene/build checks.
- `pnpm exec playwright test`: browser smoke, offline, mobile nav and install manifest checks (see `e2e/`).
- `pnpm lighthouse`: Lighthouse budget assertions on the built offline-capable app shell. This does **not** measure a fully populated live data dashboard. Performance metrics on real iPhone/slow cellular connections remain a separate staging gate. Modern Lighthouse versions no longer expose a PWA category; use the separate install/SW tests instead.
- CI defines lint/typecheck/unit, smoke, build/bundle, Playwright browser runs with mocked market APIs, Lighthouse mobile app-shell assertions, and a production dependency audit. Type checking, deterministic unit/API tests, the dependency-free smoke checks and the production/PWA build passed for v0.2. Browser, iPhone, Lighthouse and the complete remote CI workflow remain unverified here. Real-exchange integration, real iPhone push and production deployment must also pass before calling a release production-ready. A production certificate, authenticated domain and API/license permissions are external prerequisites.

The initial JS budget is **200KB gzipped** (the v0.2 validation report measures all generated application JS chunks together; this excludes CSS, images and service-worker transfer). Core Web Vitals targets: mobile Performance ≥ 90, Accessibility/SEO/Best Practices ≥ 95, LCP < 2.5s, INP < 200ms, CLS < 0.1. These are **targets**, not measured achievements in this environment.

## Deployment runbook

1. Provision a Linux VPS (server must remain running for alerts), OIDC provider + verified authenticating reverse proxy, TLS certificate, strict ingress rules that deny direct access to port 8787.
2. Put production `.env` server-only on the VPS. Run Node 22 as non-root with `systemd` or Docker restart policy. Back up `DATA_DIR` securely and restrict file permissions.
3. Verify HTTPS/HSTS, no mixed content, CSP, reverse-proxy auth/CSRF boundaries, and prevent any anonymous access to read/write `/api` including push subscription endpoints. The Node server is personal, not multi-tenant.
4. Test exchange API availability from the **actual** VPS region; Binance geo restrictions may differ from your laptop. Test complete candles, symbol availability, real forced-order stream, Trading Economics subscription, VAPID device registration.
5. Run test suite, Playwright Chromium/Firefox/WebKit (plus a real iPhone), Lighthouse, dependency audit and secrets scanner; observe 7+ days of alerts before relying on them operationally.
6. Monitor `/api/health`, alert scanner logs, stale data age, WebSocket reconnections, server memory, Push API 4xx/5xx and third-party rate limits. Add backups, uptime checks and metrics dashboards before commercial scale.
7. Roll back application code (Conventional Commits recommended) and restore `DATA_DIR` backup if persistent alerts are corrupted. Browser update prompt applies new service worker after user confirmation. Never roll back keys into client assets.

### Known gaps before multi-user production use

The current personal-use MVP does **not** include automated order execution, full market-wide Hyperliquid liquidation accounting, licensed liquidation heatmaps, complete Binance all-symbol OI ranking, advanced ADF tests, exchange-side WebSocket continuity guarantees, a real OIDC deployment config, hosted database, a verified mobile performance budget or externally executed Playwright/Lighthouse CI. These should be implementation milestones rather than hidden claims.

## Rechecking public feeds on your own machine

```bash
pnpm verify:feeds                    # inspects both venues and scans an available BTC contract
pnpm verify:feeds hyperliquid:BTC    # explicit asset
```

This read-only command exits nonzero when a venue or interval cannot be validated, including HTTP 451 region restrictions and missing historical candles. That is a reported limitation, not a request to bypass venue restrictions. It does not place orders or prove predictive performance.

The current implementation needs a persistent Node process for liquidations and alert polling. A static-only upload would omit those features. No hosted production deployment, reverse proxy, calendar credentials or iPhone push credentials were created in this continuation.
