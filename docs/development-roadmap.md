# FluxDesk development list

Updated 24 October 2026. Research only; no order execution or claimed predictive edge.

## Current milestone: v0.4 cloud terminal

| Item | State | Evidence / remaining work |
| --- | --- | --- |
| Vercel frontend and authenticated persistent Node API | Staging functional | Northflank `fluxdesk-api-staging`, existing Default project, one Sandbox instance, `/data` volume; no production promotion |
| Historical fetch and Strategy Lab | Owner accepted | Dashboard and historical research work remotely |
| Archive persistence through real service restart | Owner accepted | Archive reloaded and dataset SHA-256 matched |
| Faster exchange snapshots | Owner accepted | Foreground 10s polling, coalescing, venue backoff; explicit original ages retained |
| Shorter address | Owner accepted; authenticated API verified | `https://fluxdesk-terminal.vercel.app/` redirects logged-out visitors to Vercel SSO. Reconnected Vercel access now returns the current prerendered build and HTTP 200 for health, markets and saved favorites |
| Price basis, timestamps, live funding and price premium | Owner accepted on phone; automated checks pass | Last trade vs mark labels, exchange vs receipt ages, same-basis comparisons, Binance interval metadata and hourly Hyperliquid funding |
| Full CI | CI #338 passed at `ca229d6` | All application, cross-browser, production hydration, container, Python, performance and dependency gates passed. Optional v3 accounting and report export passed all gates. New coverage-diagnostics batch requires fresh CI. |
| Previous full validation | CI #320 passed at `6401d16` | Prior revision passed 189 unit tests, smoke/build/container checks, five development browsers, 8 production hydration tests, Lighthouse and dependency audit without test retries. New stat-arb changes add report boundary/browser coverage and a separate offline Python test job. Track latest results in PR #12 |
| Final-alias authenticated feature checks | Passed in automated live QA | Logged-out Vercel SSO, backend 401 without gateway authentication, authenticated health/700 markets, live chart/category navigation, isolated favorite save/reload/second-client/remove, original favorites retained, no page errors or horizontal mobile overflow |
| Backup and restore | Owner completed hosted export, matching download and isolated local restore | 23 October: actual Northflank encrypted archive verified, downloaded to owner’s Mac with matching SHA-256, restored into a new local directory; 7 files and all 6 original dataset IDs match. Recurring backups are manual; full live-volume disaster-recovery replacement was not exercised |
| Open-position equity and exposure cap | Phone UI accepted; mechanics tested | Engine v2 bar-close trade-price proxy, separate realized drawdown, default 1× / max 3× entry notional, versioned legacy display |
| Shared mobile/desktop watchlist | Live persistence verified | Up to 50 venue contracts, atomic backend writes, second-client refresh, no optimistic save success. The keyboard-accessible list has a bounded scroll area so larger lists do not push the chart down the page |
| Interactive TradingView library chart | Owner accepted on phone; automated checks pass | Candles/line, base-volume pane, crosshair, EMA 20/50, zoom/pan/fit and expansion; exact venue history and completed bars |
| Chart / Categories browser | Owner accepted on phone; automated checks pass | 15 overlapping curated themes, counts of available venue contracts, search and exchange filters, exact-contract chart selection |
| TradingView account indicators | External shortcut only | Optional validated saved-layout URL on this device; sign in on TradingView itself. Embedded account/Pine synchronization is unsupported and intentionally out of scope |
| General phone use | Owner accepted 23 October | Everything working properly on the phone |
| Crypto stat-arb research | Implemented; CI #320 and live QA passed | Original 19 October protocol/source/tests and synthetic report, local bounded report import, all folds and untouched-holdout status. No market edge or trading authorization; see [integration guide](statarb-integration.md) |
| Automatic price-level direction | Owner accepted on iPhone 24 October | Form previews direction; API verifies live quote and persists below/above plus reference price. Equal levels and missing live quotes fail explicitly. Creation quote arms the first scan; restart seeds a fresh observation. |
| Chart drawings | Owner accepted on iPhone 24 October | Horizontal levels, trend lines, rectangles, colors, delete/undo/clear. Device-local per venue contract/timeframe; UTC/price anchors follow zoom/pan/resize. Desktop mouse and mobile touch checks passed. |
| Historical funding / mark archive | Hosted enrichment verified | Binance enrichment creates a new immutable fingerprint; exact mark-bar alignment, bounded funding pagination, signed payment rates and source/timestamp metadata. Encrypted backup/restore tested. Payment completeness is explicitly unaudited; engine v2 excludes these data; optional exploratory v3 now includes observed payments and mark-close equity, pending deployment. Hyperliquid mark/oracle and PIT universe remain outstanding. |
| PWA update discovery | Owner reports all iPhone checks passed 24 October | Resume/reconnect checks, five-minute foreground checks, manual Check for updates. Update now still requires user action; no forced reload. |
| Price range alerts | Owner reports all iPhone checks passed 24 October | Lower/upper bounds validated and persisted; outward sampled crossings send direction-specific messages. Independent 5-minute boundary cooldowns; approximately 60s scans and first-observation arming. Automated API/scanner/browser checks cover persistence and both directions |
| Push notification subscription controls | Owner accepted enable/disable and locked-phone push | Owner configured VAPID; real iPhone enable/disable, locked-phone notification receipt and tap-to-open all passed. Diagnostic push transport was tested separately from market-rule evaluation |
| Remote iPhone PWA acceptance | Resume, offline shell and reconnect owner-passed | Installed app background/resume, airplane-mode reopen/offline indication and fresh-data recovery on reconnect passed. Locked-phone notification receipt and tap-to-open passed. Owner reports all iPhone checks passed on 24 October; no additional phone gate requested for this batch |

## Next work in order

1. CI #336 is green. Obtain green CI for the new optional v3 accounting/report-export batch, including production hydration and chart tests. Complete chart/categories, live pricing/funding, watchlist and engine v2 preview checks. Keep existing performance thresholds.
2. Latest iPhone acceptance is complete. Batch future phone checks after several changes; verify the latest CI before any promotion. Hosted backup/download/isolated restore and locked-phone push are complete.
3. Binance historical funding/mark snapshots are now implemented in Strategy Lab. Verify live hosted ingestion, audit payment schedule completeness and historical contract metadata, then validate the optional observed-funding/mark v3 engine against audited histories. The v3 implementation is exploratory, explicitly opt-in, with conservative handling of ambiguous funding/exit ordering. Hyperliquid mark/oracle history still needs a documented source. Bar-close open-position equity and entry exposure caps are implemented; intrabar margin/liquidation accounting remains outside the current engine. Never substitute today's funding for historical payments.
4. Crypto stat-arb source and offline report workflow are integrated into Correlation Lab. Next: obtain auditable historical funding/PIT data and account-tier fees, then run market walk-forward validation; do not interpret scanner correlation as cointegration. Do not open the final holdout while choosing data or adapting the integration.
5. Saved terminal layouts implemented on each device: up to ten named market/timeframe/benchmark/category/venue/sort combinations, explicit apply/delete and local-storage errors. Shared watchlists remain server-backed; layouts are not included in server backups. Saved-layout desktop/mobile regression checks pass; latest full CI/live acceptance is tracked in PR #12.

## Live funding conventions

- Binance table prices are last trades. The selected-contract panel fetches mark/index separately; price premium is `(mark / index - 1) × 100`.
- Binance `/fapi/v1/fundingInfo` supplies adjusted payment intervals. A symbol absent from a valid response uses the documented 8h default; failed/malformed metadata leaves the interval unknown. Metadata refreshes every minute.
- Hyperliquid contexts supply mark/oracle and the hourly funding rate. Price premium is `(mark / oracle - 1) × 100`, not the exchange's separately defined funding premium field. Next payment time is explicitly a schedule estimate.
- Positive reported funding means longs pay shorts; negative means shorts pay longs. Rates can change before payment. No annualized return or guaranteed carry is shown.
- Hyperliquid contexts do not contain an exchange quote timestamp. The UI labels server receipt time explicitly. Failed refreshes retain original ages and are labelled stale/unavailable.
- Live funding is a terminal display only. Existing historical backtests still exclude funding, as explicitly disclosed.

Primary references consulted 23 October 2026:

- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data
- https://www.binance.com/en/support/faq/detail/360033525031
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding

## Owner checks needed before release

- General phone UI acceptance is complete as of 23 October. Vercel access and final-alias automated feature/mutation checks pass.
- Cross-client save/reload/remove was verified in authenticated live QA; original favorites were retained.
- Installed iPhone background/resume, offline reopen and fresh-data recovery on reconnect are owner-passed. Locked-phone push receipt and tap-to-open are owner-passed. Owner reports all iPhone checks passed on 24 October.
- Actual hosted encrypted backup, matching computer download and isolated local restore are owner-completed. Archive SHA-256: `5cc39e2e462b8696ad1f5e222b9b445cb0d8e8521dfeb2cadc735ac47a79cef0`; 7 files / 6 matching dataset IDs. Keep the encrypted copy and recoverable password-manager entry. Repeat backups manually after important changes; no recurring scheduler is installed. See [backup/restore runbook](backup-restore.md).

## Current batch: exploratory accounting and report portability

- Opt-in v3 consumes archived signed funding and historical mark closes; default v2 replay stays unchanged. Missing/misaligned history fails.
- Reports include funding P&L per trade, mark-based bar-close equity and conservative ordering disclosures. Intrabar margin/liquidation and historical payment completeness remain outside its claims.
- JSON report download includes engine version, configuration, dataset receipt/fingerprint, trades, equity and warnings.
- Synthetic tests cover signs, equity/cash reconciliation, entry ambiguity, intrabar stops, gap exits, future payments, sample boundaries, legacy mode and stored-runner versioning. No actual market backtest/holdout was run by the agent.
- Next iPhone batch (after deployment/CI): optional v3 switch on an enriched snapshot, accounting labels, horizontal scrolling in the trade log, JSON report download. No individual phone interruption needed.

## Funding coverage diagnostics

Observed regular/unspecified spacing, leading/trailing window gaps, long gaps over an explicit 8h review threshold, rate signs/types and maximum absolute mark/trade close difference are derived from validated immutable snapshots. Special payment events do not imply scheduled payments. Results always require review; no missing payments, historical schedules or completeness percentage are inferred. Verbose spacing/gap lists are bounded while total counts are retained. Diagnostics travel with dataset receipts and JSON report exports; suspicious boundaries/gaps add v3 report warnings. Original dataset fingerprints remain unchanged.

Grouped phone check (after this batch deploys): open the enriched BTC snapshot’s Funding coverage panel, inspect spacing/gap table and compare it with the downloaded JSON report. Bundle with the previously listed v3/report checks.
