# Project checkup — 25 October 2026

Scope: review of the price-data path, client state/query lifetimes, cache integrity, UI text, chart rendering, API/auth boundaries, journal/scanner safeguards, PWA network handling, dependency audit and regression coverage. This is an application review, not a penetration test or empirical strategy validation.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| The chart's default price line represented its last **completed trade candle**. The selected-market header/table instead used a 10-second quote snapshot; detail history polled every minute. | The chart now receives the exact same selected `Market` object as the dashboard. Its highlighted live price line and quote label use that quote, not an independently fetched or synthesized value. Mode switches preserve the quote line. Closed OHLC stays unchanged and is explicitly labelled. |
| Hyperliquid table quotes are marks, while historical candles are trades. Forcing them to match would corrupt candle history. | Quote line/badge explicitly says Mark or Last trade; completed trade candles remain separate. Binance uses its last trade. Unknown/stale/offline/wrong-contract quotes are withheld, not passed off as live. |
| A cached closed-only history can become obsolete before the 30-second TTL when a new interval completes. | Revalidation invalidates and refetches that cache entry once when stale. It never promotes a cached unfinished bar into completed history. Synthetic boundary test proves the newly fetched closing value is used. |
| Asset detail continued polling on journal/scanner/calendar tabs. | Detail queries run only on Markets and Entry models. Market snapshots still serve other workspaces that need them, including open-position estimates. |
| The frontend trusted a detail payload's identity. | A wrong contract/timeframe response now produces an explicit error instead of rendering another contract's candles. Fixtures now model the API's actual identity fields. |
| Long explanatory paragraphs competed with controls and figures. | Market data, positioning limits, funding conventions, categories, correlation, scanner coverage, journal accounting/import limits and research usage notes are behind labelled native details controls. Duplicate introductory/feed-refresh text was removed or shortened. Errors, stale/offline statuses, price bases, direction, fees/risk assumptions and key research-result labels remain visible. |
| Strategy Lab still displayed an old v0.3 heading. | Workspace heading is simply Strategy Lab. Engine versions in research results are retained. |
| Production Playwright runs cleared the development trace/screenshot directory. | Production outputs have their own subdirectory, preserving both sets for CI upload. |

The read-only deployed API comparison reproduced the difference: BTCUSDT table last trade 80,818.20 versus last closed hourly candle 80,843.70, a difference of −25.50. Those are different observations, not interchangeable prices. The fix changes the chart's live reference, not provider OHLC, funding history, alert evaluation or scanner selection rules.

The live overlay uses the known quote basis, exact contract ID and source timestamp. It expires at 45 seconds, with five seconds of forward clock tolerance; eligibility is reevaluated on the dashboard's five-second clock. Only the currently displayed latest history range is expanded to include the quote, so panning into the past does not flatten the historical price scale. Historical chart rendering, indicators and drawings continue to use completed bars. No fake in-progress candle or volume is created.

## Verification

- Types/lint; 278 unit/API tests; eight Node smoke checks.
- Browser regression coverage includes quote/header equality after polling, Binance-to-Hyperliquid switching, chart modes, offline withdrawal, mismatched response rejection, keyboard-accessible disclosure content and existing drawings/journal workflows.
- Production HTML/hydration and canvas startup are checked separately. Desktop/mobile screenshots were inspected.
- Runtime dependency audit: zero advisories. Full development audit: eight findings (five high, two moderate, one low; zero critical). Existing production-only image isolation remains in place; remaining build-tool issues need upstream/major-tool work. No blanket clean security audit is claimed.
- The PWA continues to keep API GET/POST traffic network-only; no market data is fabricated for offline use. Gateway authentication, revision protection and encrypted-backup tests remain unchanged.
- Full hosted checks, release commit and final deployment/alias evidence are recorded in the associated PR. New development uses a separate branch; the Northflank backend release branch is advanced only deliberately to a tested main commit.

## Remaining limits

The chart's live reference is a sampled quote (foreground polling), not a tick WebSocket feed. Historical OHLC and trade volume are closed-bar observations. Mark and last-trade differences are genuine market conventions. Historical PIT/funding completeness, account-tier fee evidence, empirical stat-arb validation and intrabar liquidation modelling remain separate research inputs/work. Provider quotes can be unavailable or stale; those states remain explicit.

Primary technical references reviewed:

- https://tradingview.github.io/lightweight-charts/tutorials/how_to/price-line
- https://tradingview.github.io/lightweight-charts/docs/api/interfaces/SeriesOptionsCommon
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
