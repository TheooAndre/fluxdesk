# FluxDesk development list

Updated 23 October 2026. Research only; no order execution or claimed predictive edge.

## Current milestone: v0.4 cloud terminal

| Item | State | Evidence / remaining work |
| --- | --- | --- |
| Vercel frontend and authenticated persistent Node API | Staging functional | Northflank `fluxdesk-api-staging`, existing Default project, one Sandbox instance, `/data` volume; no production promotion |
| Historical fetch and Strategy Lab | Owner accepted | Dashboard and historical research work remotely |
| Archive persistence through real service restart | Owner accepted | Archive reloaded and dataset SHA-256 matched |
| Faster exchange snapshots | Owner accepted | Foreground 10s polling, coalescing, venue backoff; explicit original ages retained |
| Shorter address | Owner accepted | Owner reports working; final exact alias and its protection have not been independently verified |
| Price basis, timestamps, live funding and price premium | Implemented; preview acceptance pending | Last trade vs mark labels, exchange vs receipt ages, same-basis comparisons, Binance interval metadata and hourly Hyperliquid funding |
| Full CI at latest feature commit | Pending | Prior CI #304 passed functional/container/browser gates but failed LCP: 2685ms vs 2500ms; thresholds stay unchanged |
| All-deployment authentication / mutation checks at final alias | Pending | Check logged-out access and authenticated mutations on final address |
| Backup and restore | Pending | Durable volume restart is verified; offsite backup and isolated restore still need verification |
| Remote iPhone PWA acceptance | Pending | Installed Safari app, reopen/resume, offline shell, reconnect, update flow and alerts |

## Next work in order

1. Complete the live pricing/funding preview check and page-load performance fix; obtain green CI.
2. Finish cloud release gates above, including an actual backup/restore exercise, before promotion.
3. Improve historical Strategy Lab accounting: historical funding datasets, marked-to-market drawdown and explicit leverage/capital limits. Never use today's funding as a substitute for historical payments.
4. Add a separate statistical research engine for pair stationarity and hedge stability with out-of-sample validation.
5. Add persistent mobile watchlists and saved terminal layouts.

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
