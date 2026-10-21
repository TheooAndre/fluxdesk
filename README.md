# FluxDesk: Binance + Hyperliquid Market Intelligence

A **read-only**, self-hosted trading research dashboard. Native iOS app packaging is not required: it is an installable React/Vite progressive web app, with an optional server-side Web Push service. **No exchange API keys or trade execution are used.**

> Scope: personal single-user research dashboard, not a validated alpha engine. The four trading models are deterministic **candidates** and must be properly backtested before relying on them. It is deliberately not a financial-advice product.

## Architecture decision record (ADR-001)

- **Vite + React + strict TypeScript**: a client-heavy terminal that does not require SEO/SSR. Keeps the iPhone app installable and compact. TanStack Query handles server refresh and caching; Zustand manages UI filters.
- **Tailwind / design-token theme**: responsive dark UI with meaningful labels, keyboard support and reduced-motion handling. SVG charts avoid heavyweight chart dependencies.
- **Node 22 native HTTP + fetch/WebSocket aggregator**: a single small backend prevents browser CORS issues, stores source secrets securely, and gathers exchange liquidations even when iPhone Safari is closed. There is deliberately no brokerage API-key or exchange order-placement flow.
- **JSON persistence with atomic write**: sufficient for a **single process / personal server**. This is *not* a horizontally scalable PostgreSQL system; moving to multi-user or multi-instance deployment requires authenticated user data separation, PostgreSQL and a durable job queue.
- **Workbox (injectManifest)**: offline shell + update prompt, network-first short-lived market API cache, stale-while-revalidate styles, immutable asset cache, background sync for POST `/api/alerts`. Clients opt in to push notifications explicitly.
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
- Economic calendar reads Trading Economics **importance=3** events for the US from a configured commercial API key; without it, events are explicitly unavailable instead of fabricating a schedule.
- iOS PWA installation help and push opt-in. Apple Web Push requires a supported iOS version and installation to Home Screen; permission must come from a user gesture.

## Data integrity warnings

1. **Binance `!forceOrder@arr` is a sampled stream**, at most one liquidation order snapshot per symbol per second. Sum of observed snapshots **is not the true total liquidations** (and may underreport or miss events). The app correctly labels it partial. Public Hyperliquid all-account liquidation notional is **not** implemented; per-user liquidation/fill events do not imply a complete market-wide liquidation stream.
2. Liquidation *future levels* are not observable from OHLCV and OI alone. The app instead shows transparent support/resistance and historical observed liquidation execution prices. Actual forward liquidation maps require an appropriately licensed vendor, a venue-specific on-chain reconstruction, or a documented estimation model with large uncertainty.
3. Hyperliquid perp data is USDC-collateralized / quoted; Binance uses USDT. The UI shows USD-equivalent **approximations**, not a guaranteed stablecoin FX-adjusted notional. Funding, basis, quote conventions and contract types vary.
4. Gold here is **XAUUSDT perpetual**, not spot bullion or an independent XAUUSD economic time series. It may not be offered in your region.
5. Exchange connector API calls can fail because of regional geoblocking, upstream rate limits, or downtime. The server caches recent values briefly; stale values must not be interpreted as real-time quotes. Correlation scanning makes up to 29 historical candle requests, so use it responsibly.
6. The system does not claim a profitable pattern, cointegrated pair, high-probability setup or backtested strategy. There is no live execution, fill simulator or drawdown-based automated trading.

## Phase 1: macOS development and verification (2026-10-20)

**Status: backend integration tested with controlled exchange fixtures, browser build not yet certified.** The patch fixes asset switching across venues, enforces full-history price levels, validates full instrument IDs, supports optional/lazy Web Push dependencies for a no-VAPID local backend, and reports partial venue availability explicitly. It also improves persistence-write recovery. It does **not** claim profitable entry setups, successful live exchange connections, or an iPhone production release.

### Exact steps for your Mac

1. Install **Node.js 22 LTS** (recommended for this repo) and use Terminal (macOS zsh). With Homebrew, run:

```bash
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version
```

Alternatively, use an official Node 22 LTS installer or an existing version manager. The repository supports Node 22 through 24, but the default build/test instructions target Node 22. For a permanent Homebrew path setup, add the export line to `~/.zshrc`.

2. Extract `fluxdesk-phase1-mac.zip` to your workspace, such as `~/Developer` (Finder can unzip it). In Terminal:

```bash
cd ~/Developer/fluxdesk
./scripts/mac-setup.sh
```

The script initializes Corepack/pnpm, creates `.env` if absent, installs pinned packages, runs a local prerequisite doctor, and executes the code quality checks and deterministic tests. **Internet access is required for the first dependency install.** The first successful `pnpm install` produces `pnpm-lock.yaml`; **commit that file to Git** to enable reproducible CI. The source archive cannot contain a verified lockfile because this build environment cannot reach the npm registry. CI will intentionally reject a missing lockfile rather than silently resolving new dependency versions.

3. Launch the frontend and backend together:

```bash
pnpm dev
```

Open **http://127.0.0.1:5173** in Chrome/Safari on the Mac. For separate terminals: `pnpm dev:api` (port 8787) and `pnpm exec vite --host 127.0.0.1` (port 5173). The API always binds to loopback by default.

4. Confirm the backend and analytics:

```bash
pnpm doctor
pnpm test:smoke
pnpm test:integration
pnpm check
curl -fsS http://127.0.0.1:8787/api/health
```

`pnpm test:integration` launches a temporary **mocked** API server on a free loopback port, exercising both exchange connectors, candle completion, all-timeframe scans, and alert creation/delete. It does *not* contact either real exchange. `/api/markets` on the real local backend DOES contact real Binance/Hyperliquid endpoints; a missing exchange appears as an explicit degradation notice.

5. After dependency installation, install the browser test engines and run end-to-end tests:

```bash
pnpm exec playwright install chromium firefox webkit
pnpm e2e
pnpm build
pnpm start
```

The default E2E suite intercepts exchange responses with fixtures; live data verification requires manually checking Markets, switching venues/assets, all-timeframe Signals, Pair correlation, and alert creation/removal against actual endpoints. On macOS, Playwright WebKit is **not** equivalent to verifying Safari PWA install and iOS push notifications on a physical iPhone. That's a later HTTPS deployment gate.

**Troubleshooting:**

- `pnpm: command not found`: run `corepack enable && corepack prepare pnpm@10.18.0 --activate` (or install Corepack for your Node distribution).
- `EADDRINUSE` on 5173/8787: shut down the older dev process; `lsof -nP -iTCP:8787 -sTCP:LISTEN` identifies the API port owner.
- Binance 403/451 or network errors: check regional availability and network policy; the app should not replace inaccessible prices with invented numbers. The browser can run with mocked APIs under Playwright.
- `/api/calendar` empty: Trading Economics key is optional; no unverified macro dates are synthesized.
- iOS install or push unavailable from `http://127.0.0.1`: actual iPhone use requires a secure HTTPS origin; the Mac loopback URL is **only for local Mac development**.
- `pnpm check` fails: do not claim Phase 1 passed. Preserve the full error output, fix the root cause, rerun, then create a lockfile commit.

**Phase 1 verification already run in this environment:** Node 22 dependency-free `node --experimental-strip-types --test tests/smoke.node.mjs tests/integration.node.mjs`, with **16 tests passing** after the changes; upstream fixture integration exercises live server endpoints but not live exchange internet. npm/pnpm package download, full TypeScript typechecking with dependency types, Vite bundle build, full Vitest, browser E2E and Lighthouse remain blocked here by registry DNS access and must be run on your Mac.

## Local setup

Prerequisites: Node 22 LTS, pnpm 10.x. From repository root:

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
| `TRADING_ECONOMICS_API_KEY` | Optional licensed calendar key; US high-importance data |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional Web Push credentials; e.g. `mailto:you@yourdomain.tld` |

Generate VAPID keys with a local package command after installing dependencies: `pnpm exec web-push generate-vapid-keys`. Keep private key secret. Never set `REVERSE_PROXY_OIDC=true` as a shortcut to open network access.

## PWA / iOS gotchas

- Safari on iOS requires **Share → Add to Home Screen**. Some PWA install / Web Push behavior differs from desktop Chrome; test on physical iPhone over HTTPS.
- Service worker is only fully active in `pnpm build` + real-origin deployment, not the ordinary Vite dev experience. The app prompts for a new version; it does **not** auto-activate a new service worker during an active view.
- Workbox queues `POST /api/alerts` for connectivity recovery for up to 24h. A queued alert is **not actually active** until server receives it; sync only works when supported by browser and the service worker runs. Do not depend on iOS Background Sync for critical alert guarantees.
- Alerts are evaluated **on the running Node server**, not on the iPhone. To get notifications while the app is closed, keep the backend online, register push from an installed iPhone, and provide an OIDC-protected HTTPS hostname. Delivery is best-effort, not guaranteed.
- For a packaged native iOS app, APNs is a different integration not included here.

## Multi-timeframe signal scanning

The **Entry models** tab automatically scans the selected contract on **all native candle intervals** and reports candidates in either direction. Binance intervals are `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M`; Hyperliquid supports the same set without `6h`. The scanner is on demand and bounded to four concurrent historical candle requests per selected asset. Every signal uses the final completed exchange candle; if an interval fails it is explicitly reported. Scans are not continuous multi-asset monitoring or push signals. Choosing a candidate opens its timeframe in the detailed model view. Monthly boundaries use exchange-provided candle close times, never a fake fixed-length month.

## Signal mathematics

Let `x_t = log(P_A,t)` and `y_t = log(P_B,t)` for **aligned completed bars**. Rolling OLS on previous W=80 bars estimates `β` and intercept. Current residual = `x_t − α_(t−1) − β_(t−1)y_t`; displayed `z_t` standardizes by the *previous* residual sample mean/standard deviation. Scanner correlation uses Pearson r of aligned log returns with sample length ≥ 30. A positive (negative) spread z-score only means above (below) rolling historical residual; it **does not** by itself imply a short (long) edge. Engle-Granger/ADF, half-life stability, walk-forward cost-aware OOS research and a preregistered hypothesis remain necessary.

Entry models intentionally share **fixed illustrative** parameter defaults; avoid optimizing these in-sample without a separate untouched OOS holdout. SFP uses prior 20-bar extremes; MSB uses pivots *confirmed* with two right-hand bars; pullback uses EMA20 vs EMA50 and a close back across EMA20; chop rejects range edges under low range width/trend slope. Each candidate uses structural/ATR invalidation and illustrative target at 2R from latest close. No order fill is assumed.

## Testing, performance and release gate

- `pnpm test`: Vitest deterministic algebra/indicator/bias checks. A dependency-free sanity run is available via `node --experimental-strip-types --test tests/smoke.node.mjs` on Node 22.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: code hygiene/build checks.
- `pnpm exec playwright test`: browser smoke, offline, mobile nav and install manifest checks (see `e2e/`).
- `pnpm lighthouse`: Lighthouse budget assertions on the built offline-capable app shell. This does **not** measure a fully populated live data dashboard. Performance metrics on real iPhone/slow cellular connections remain a separate staging gate. Modern Lighthouse versions no longer expose a PWA category; use the separate install/SW tests instead.
- CI defines lint/typecheck/unit, smoke, build/bundle, Playwright browser runs with mocked market APIs, Lighthouse mobile app-shell assertions, and a production dependency audit. These gates have **not been run successfully in the current offline environment**. Real-exchange integration, real iPhone push and production deployment must also pass before calling a release production-ready. A production certificate, authenticated domain and API/license permissions are external prerequisites.

The JavaScript budget is **200KB gzipped**; CI now sums all built JS chunks as a conservative upper bound. The actual initial-route transferred bytes also require Chrome network-trace verification. Core Web Vitals targets: mobile Performance ≥ 90, Accessibility/SEO/Best Practices ≥ 95, LCP < 2.5s, INP < 200ms, CLS < 0.1. These are **targets**, not measured achievements in this environment.

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


### Flexible comparison benchmarks (v0.2 preview)

The Compare Against selector supports the USD/USDT cash baseline (0% return) and every currently discovered Binance USDT perpetual or Hyperliquid perpetual, identified by venue and symbol. The market-table relative-return calculation is `(1 + asset_return/100)/(1 + benchmark_return/100) - 1`, expressed as a percentage. Exchange returns may use different 24-hour reference conventions, so cross-venue comparisons are approximate. The cash baseline is a nominal zero-return reference, not a tradeable FX instrument. Benchmark OI ratios use the selected venue-specific instrument and are unavailable for USD. The selection applies to 24h relative performance, not to the historical chart or signal scanner.
