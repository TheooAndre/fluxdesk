# Historical funding and mark-price archive

Implemented 24 October 2026. This is data collection, not a strategy variant or evidence of an edge. It does not run a backtest or open the stat-arb holdout.

In Strategy Lab, select an existing Binance dataset and choose **Archive funding & mark history**. The bounded enrichment supports up to 1,000 bars and 90 days. It keeps the original file and creates a new content-addressed dataset containing the same trade candles plus historical funding payments and mark OHLC. An already enriched snapshot returns its existing receipt. Existing datasets and their fingerprints remain valid.

## Data contract

- Mark OHLC comes only from `/fapi/v1/markPriceKlines`; every open/close timestamp must match the original trade-candle grid. Missing, duplicated, shifted or invalid bars fail before saving. Mark bars contain no fabricated volume.
- Funding comes only from `/fapi/v1/fundingRate`, with the exact original start/end window. Signed decimal rates, payment timestamps, funding-time mark prices and reported payment types are retained. Missing `rateType` is labelled `unspecified`, not guessed.
- Funding pagination repeats boundary timestamps and deduplicates exact overlaps so different payment types at the same timestamp are retained. Changed duplicates, non-progress, malformed values, empty histories or exhausted page budgets fail. At most two mark requests and five funding requests run, with the existing nine-second per-request timeout.
- The archive records sources and retrieval time, distinct from the trade-candle capture time. No live rate, current payment interval, synthetic payment or forward-fill is substituted.
- `fundingCoverage: observed_unverified` deliberately does not claim every expected payment was returned. The historical payment schedule, contract lifecycle and source completeness still require audit. A fingerprint protects stored contents, not exchange authenticity or completeness.
- All fields participate in the dataset SHA-256. Dataset loading, encrypted backup verification and isolated restore revalidate the history.
- HTTP uses `POST /api/research/market-history` with `{ "datasetId": "<sha256>" }`, existing gateway/origin checks, archive limits and the single active research-operation lock. It never accepts arbitrary paths or URLs.

## Accounting boundary

Strategy Lab displays counts, first/last mark closes and the last eight observed funding payments. The default v2 backtest uses trade closes and excludes funding/mark accounting. The opt-in `observed-funding-mark-v3` engine now uses observed archived payments and mark closes. It fails on missing/misaligned history and does not assert payment completeness. No performance improvement is claimed.

Next: audit actual hosted data against historical schedules, add correctly timed funding cash flows and historical mark valuation to a new engine version, and test boundary/event ordering, long/short signs, fees, splits and missing data before enabling it. Crypto stat-arb additionally requires an auditable point-in-time universe including delisted contracts, account-tier fees and a fixed research protocol before market walk-forward validation. The final holdout remains untouched. Hyperliquid historical mark/oracle data is not connected.

## Verification

Synthetic mechanics tests cover multi-page requests, boundary payment types, bad/missing data, immutable fingerprints, HTTP guards and encrypted archive/restore. Desktop/mobile browser tests cover failure recovery, the new receipt, persisted selection and accounting disclosures. A direct Binance live check from the development environment timed out; actual source coverage is not claimed from fixtures.

Primary source, checked 24 October 2026: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data (Get Funding Rate History; Mark Price Kline/Candlestick Data).

## Exploratory v3 event and equity conventions

Enable **Use archived funding and mark prices** only on an enriched dataset. Positive rates debit longs and credit shorts using position units times the exchange funding-time mark. Cash-flow signs reverse for negative rates. Payments outside the trade are excluded. Funding exactly at entry, at a gap-open exit, or within an intrabar stop/target exit candle has unknown fill ordering: include possible debits, omit uncertain credits. Gap stops are timestamped at the opening price/time; intrabar exit times remain conservative candle-close proxies. Forced sample-end exits use known closes. This is a conservative bar model, not exact exchange settlement simulation.

Bar-close equity includes paid entry fees, funding observed by that close, and open P&L at the matching mark close. Exit bars reconcile to realized trade-fill P&L less fees plus modeled funding. Subsequent sizing uses realized net equity. Funding is not reserved in the initial stop-risk estimate; funding and gaps can exceed that risk budget. No positions cross the chronological development/holdout boundary. Existing v2 output remains reproducible with the option off.

Reports can be downloaded as JSON with engine version, assumptions, dataset fingerprint and all returned results. Tests use synthetic data; the agent has not run an actual market holdout for this change. Remaining work includes historical schedule/PIT audits, account-tier fee verification, Hyperliquid mark/oracle data and empirical validation.
