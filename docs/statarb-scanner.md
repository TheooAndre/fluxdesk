# Venue-wide stat-arb discovery scanner

The terminal's Stat-arb scanner and Correlation → Stat-arb scanner now run an on-demand job over the selected venue's entire **current live perpetual universe**. Original offline research/protocol/report tools remain under “Show original research protocol.” No exchange orders are placed.

## Fixed setup and explicit variants

One strategy family: a positive log-OLS hedge, spread `log(y) − intercept − beta × log(x)`, mean-reversion z-score from the latest 90 completed spread observations (sample SD), deviation reference ±2, mean-exit reference ±0.5 and stop reference ±4. Formation excludes the latest signal candle; its last price is then evaluated with the frozen hedge. Pair notional weights are y:x = 1:beta, not equal coin quantities. Positive z corresponds to short y / long x; negative z reverses those legs. Beyond ±4 is visibly flagged. These are discovery stances, not automated execution instructions.

The user requested less restrictive crypto discovery. Two declared, fixed presets are provided, with no optimization or backtest selection:

- **Crypto discovery (default):** residual Engle–Granger test passes the unadjusted 10% critical value; positive beta. No volume, OI, Pearson-correlation, I(1) pre-screen, stability, half-life or FDR gate. Stability/half-life/weak-significance flags remain visible.
- **Selective:** unadjusted 5% EG, beta drift below 35%, finite half-life 2–90 bars. This is still a discovery screen, not the original research acceptance protocol.

Formation choices are 180, 300 (default), 500 or 1080 bars. The original default formation is 1080 4h bars; shorter/timeframe-adjusted scans are explicitly different variants. Supported fixed timeframes: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d; Binance additionally 6h.

## Statistical implementation and limitations

`log-ols-eg-adf1-mackinnon2010-unadjusted-v1`: constant in first-stage log OLS; residual ADF with **one fixed difference lag and no constant**; MacKinnon 2010 N=2, constant-first-stage finite-sample 1%/5%/10% critical values at formation n−1. Original Python research uses I(1) screening, BIC autolag up to six lags, FDR and more validation gates; the scanner does not claim numerical identity with that selection pipeline. Positive finite AR(1) half-life and formation-half beta drift are descriptive diagnostics.

The unit reference file was generated independently with statsmodels 0.14.6 `coint(trend='c', maxlag=1, autolag=None)` on two disclosed synthetic fixtures (seed 717). JS hedge/intercept, residual ADF, all critical values and z-score match to six decimal places. One independent random-walk fixture produces a nominal 5% false positive in both implementations. This is preserved in tests, not selected away. Testing many pairs without multiplicity correction increases false discoveries. An EG result assumes appropriate integration behavior; the permissive scanner does not independently establish it. Stable convergence, executable net edge and out-of-sample performance are not established.

Primary references checked 24 October 2026:
- https://www.statsmodels.org/v0.14.1/_modules/statsmodels/tsa/stattools.html (Engle–Granger residual regression)
- https://github.com/statsmodels/statsmodels/blob/main/statsmodels/tsa/adfvalues.py (MacKinnon N=2 finite-sample critical-value coefficients)
- https://www.econstor.eu/bitstream/10419/67744/1/616664753.pdf (MacKinnon 2010)

## Runtime and coverage

A single asynchronous Node job pins its candle window to scan start. Every live asset on the chosen venue is attempted, two histories concurrently. Batches are paced using conservative endpoint-weight budgets (Binance target 20 weight/s; Hyperliquid target 10 weight/s, leaving capacity for terminal queries). The Hyperliquid page-weight plus per-60-row cost is included. Provider errors still appear explicitly; no fabricated successful coverage is reported. Missing/gapped history fails explicitly; all unordered pairs of successfully loaded, exactly aligned histories are tested once in alphabetical orientation. Degenerate/near-identical residuals and nonpositive hedges are rejected. Progress includes total assets, loaded/failed histories, tested/invalid pairs, total passing and |z|≥2 counts. The job yields every 40 pairs to keep the API responsive. Up to 1200 assets; exceeding that rejects the job rather than silently truncating the universe.

Results retain the 500 strongest candidates, prioritizing |z|≥2 and then lower ADF statistic; counters include all tested pairs. Pagination/search/watch filtering applies to retained results. Fetching a full venue can take minutes and older timeframe results can become stale; scan start and settings remain visible. One active job, one-minute start cooldown, explicit cancel; jobs/results are process-memory only and reset after redeployment/restart. No paid worker or compute upgrade is added.

Endpoints: GET/POST/DELETE `/api/statarb/scan`, existing gateway and mutation-origin guard. GET only reads status; no automatic scan is started on page load. JSON export includes method, settings, timestamps, progress, failures and candidates. “Journal pair” opens a dated, unsaved two-leg draft with scanner context; quantities and risk require the user's input. No market holdout is opened by this scanner.

Rate-limit reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits (checked 24 October 2026).
