# FluxDesk development list

Updated 23 October 2026. Research only; no order execution or claimed predictive edge.

## Current milestone: v0.4 cloud terminal

| Item | State | Evidence / remaining work |
| --- | --- | --- |
| Vercel frontend and authenticated persistent Node API | Staging functional | Northflank `fluxdesk-api-staging`, existing Default project, one Sandbox instance, `/data` volume; no production promotion |
| Historical fetch and Strategy Lab | Owner accepted | Dashboard and historical research work remotely |
| Archive persistence through real service restart | Owner accepted | Archive reloaded and dataset SHA-256 matched |
| Faster exchange snapshots | Owner accepted | Foreground 10s polling, coalescing, venue backoff; explicit original ages retained |
| Shorter address | Owner accepted; authenticated API verified | `https://fluxdesk-terminal.vercel.app/` redirects logged-out visitors to Vercel SSO. Reconnected Vercel access now returns the current prerendered build and HTTP 200 for health, markets and saved favorites |
| Price basis, timestamps, live funding and price premium | Implemented; preview acceptance pending | Last trade vs mark labels, exchange vs receipt ages, same-basis comparisons, Binance interval metadata and hourly Hyperliquid funding |
| Full CI | Core CI green; final list layout checks pending | CI #316 passed 189 unit tests, smoke/build/container checks, five development browsers, 8 production hydration tests, Lighthouse and dependency audit. One Firefox watchlist case passed on retry; traces are now retained even for retried passing jobs. The compact list layout passes 4 focused desktop/mobile checks. Track latest results in PR #12 |
| Final-alias authenticated feature checks | Passed in automated live QA | Logged-out Vercel SSO, backend 401 without gateway authentication, authenticated health/700 markets, live chart/category navigation, isolated favorite save/reload/second-client/remove, original favorites retained, no page errors or horizontal mobile overflow |
| Backup and restore | Tool implemented; hosted/offsite acceptance pending | Encrypted CLI backup/verify/restore; local dataset fingerprint round-trip passes. An actual Northflank backup and offsite copy/restore remain unverified |
| Open-position equity and exposure cap | Implemented; preview acceptance pending | Engine v2 bar-close trade-price proxy, separate realized drawdown, default 1× / max 3× entry notional, versioned legacy display |
| Shared mobile/desktop watchlist | Live persistence verified | Up to 50 venue contracts, atomic backend writes, second-client refresh, no optimistic save success. The keyboard-accessible list has a bounded scroll area so larger lists do not push the chart down the page |
| Interactive TradingView library chart | Implemented; preview acceptance pending | Candles/line, base-volume pane, crosshair, EMA 20/50, zoom/pan/fit and expansion; exact venue history and completed bars |
| Chart / Categories browser | Implemented; preview acceptance pending | 15 overlapping curated themes, counts of available venue contracts, search and exchange filters, exact-contract chart selection |
| TradingView account indicators | External shortcut only | Optional validated saved-layout URL on this device; sign in on TradingView itself. Embedded account/Pine synchronization is unsupported and intentionally out of scope |
| Remote iPhone PWA acceptance | Pending | Installed Safari app, reopen/resume, offline shell, reconnect, update flow and alerts |

## Next work in order

1. Obtain green CI at the latest commit, including production hydration and chart tests. Complete chart/categories, live pricing/funding, watchlist and engine v2 preview checks. Keep existing performance thresholds.
2. Finish cloud release gates above, including an actual backup/restore exercise, before promotion.
3. Add historical funding datasets and real mark/oracle price histories to Strategy Lab. Bar-close open-position equity and entry exposure caps are implemented; intrabar margin/liquidation accounting remains outside the current engine. Never substitute today's funding for historical payments.
4. Add a separate statistical research engine for pair stationarity and hedge stability with out-of-sample validation.
5. Add saved terminal layouts; the shared persistent watchlist is implemented.

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

- Vercel access is restored and final-alias automated feature/mutation checks pass. Accept the rendered chart/categories and saved favorites on the physical iPhone app.
- With both preview frontend and Northflank backend on the latest commit, save a venue-specific market on one device, reload, and confirm it appears on the other device. Confirm removal persists too.
- On the installed iPhone app: reopen, background/resume, offline shell, reconnect, update and alert delivery.
- Choose the destination for an encrypted offsite backup. Keep its password in the owner's password manager; do not send credentials in chat. Follow [backup/restore runbook](backup-restore.md) and verify the actual hosted archive separately from local fixture tests.
