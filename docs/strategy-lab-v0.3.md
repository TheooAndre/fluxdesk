# Strategy Lab v0.3: research engine (draft)

This module is **research-only**. It does not connect an account, place orders, or claim
a profitable edge. It is connected to a browser preview but has no exchange execution integration.

## Browser Strategy Lab (research preview)

Open **Strategy Lab** from the FluxDesk desktop sidebar or iPhone bottom navigation.
The panel is lazily loaded so the market overview does not need to download
research UI code on initial launch.

The browser can retrieve verified historical candle data from the backend,
select an archived dataset, choose one of the four existing rule-based entry
detectors, and run a read-only backtest. It displays the dataset fingerprint,
development/holdout sample summaries, closed-trade equity curve, trade log,
and explicit warnings. No simulated trade is sent to an exchange.

The three API endpoints are:

- `GET /api/research/datasets`: list validated local dataset receipts and count
  discarded/corrupt snapshots, without exposing raw candles.
- `POST /api/research/datasets`: accept `{ "assetId": "binance:BTCUSDT",
  "interval": "1h", "count": 1000 }`. Validated fixed intervals, maximum
  1,000 bars per UI request. The backend fetches directly from the venue,
  fails closed on missing candle pages and stores the resulting fingerprint.
- `POST /api/research/backtests`: accept `{ "datasetId": "<sha256>",
  "config": { ... } }`. Return a versioned, provenance-linked simulation
  report. Risk and transaction cost assumptions have strict finite bounds.

The backend allows only **one active research operation per process**; other
requests receive HTTP 409 rather than starting unbounded concurrent work.
Authentication remains the same single-user HTTPS/OIDC deployment boundary as
the rest of FluxDesk, and mutation requests enforce the application's existing
same-origin checks. Endpoints do not import arbitrary user-selected file paths.

Research results are currently held in browser memory, not saved as a server
journal. After a reload, reselect the archived dataset and run the analysis
again. Dataset archives remain on the local server and are excluded from Git.

## Workflow

1. Obtain genuine completed historical candles from a documented exchange source.
   Store exchange/contract identity and retrieval time. Do not mix venues or overwrite
   missing intervals with invented candles.
2. Build a dataset JSON using the schema below and import it:
   `pnpm research import ./my-btc-hourly.json`
3. Save the returned SHA-256 dataset ID. It fingerprints the entire supplied dataset.
4. Create `config.json` with an explicit strategy, risk, fees, slippage and holdout.
5. Run `pnpm research backtest <dataset-id> ./config.json`.
6. Read the *development* and *holdout* summaries independently. Treat fewer than
   30 holdout trades as insufficient evidence, even if the observed returns are positive.

Data files are stored under `DATA_DIR/research/datasets/` (default `data/research/datasets/`).
Files are content-addressed, checksum-verified on load and atomically published.
They must be backed up. The fingerprint detects accidental modifications, but is
**not an authenticity signature** from Binance or Hyperliquid.

## Dataset JSON

```json
{
  "schemaVersion": 1,
  "venue": "binance",
  "assetId": "binance:BTCUSDT",
  "interval": "1h",
  "capturedAt": 1760000000000,
  "candles": [
    {
      "time": 1759000000000,
      "closeTime": 1759003599999,
      "open": 100,
      "high": 102,
      "low": 99,
      "close": 101,
      "volumeBase": 20,
      "volumeUsd": 2020
    }
  ]
}
```

**Illustrative format only:** this one-candle example is not a valid import or
real historical quote. Imports require 80–50,000 sequential, fully completed,
timestamp-consistent candles. Times use Unix epoch milliseconds. Exchanges
and intervals must match their market IDs. A non-monthly bar's closeTime is
inclusive and must equal the next candle open time minus one millisecond.

## Research configuration JSON

```json
{
  "model": "sfp",
  "initialEquity": 10000,
  "riskFraction": 0.01,
  "costs": {
    "feeBpsPerSide": 4,
    "slippageBpsPerSide": 5
  },
  "holdoutFraction": 0.25
}
```

The fee/slippage values above are **user-selected assumptions**, not verified
venue quotes. Set them from your own actual fee tier, expected liquidity and
realistic execution conditions. Results change when assumptions change.

## Simulation rules

- Only completed candles enter the detector. The earliest entry is the next
  candle's open, adjusted adversely by entry slippage.
- A trade is rejected if a gap makes its preselected stop or target nonsensical.
- Position size uses the chosen equity-risk budget and includes a conservative
  round-trip transaction-cost buffer.
- A trade whose intrabar high/low touches both stop and target is stopped first.
  A gap through the stop receives its worse opening price. Exit slippage and
  fees are deducted.
- One position per strategy. No signal opens while a position is active.
- Development trades close at the development/holdout split. A holdout entry
  requires a signal *inside* holdout; old candles may only warm indicators.
- An unfinished final trade is marked at the final available candle close,
  not represented as an actual exchange fill.
- Exit timestamps for stop/target are candle-close timestamps, not exact
  intrabar executions.
- Results include expectancy in risk units, net P&L, win rate and closed-trade
  equity drawdown, not an intratrade drawdown measure.

## Limitations / further gates

- Bounded Binance/Hyperliquid HTTP historical backfill is implemented for fixed
  intervals; deeper multi-year archives, independent provider reconciliation,
  resumed ingestion and automated funding history remain **not implemented**.
  Hyperliquid `volumeUsd` is estimated from base volume and OHLC midpoint,
  not an exchange-reported historical quote notional.
- No independent walk-forward folds or parameter-search embargo yet.
- No funding, financing, leverage limits, partial fills, latency, exchange
  minimum quantities, market impact, or liquidation simulation.
- Conservative OHLC bar sequencing is a simplification, not tick-by-tick replay.
- The tool does not establish out-of-sample statistical significance merely
  by separating dates. Research conclusions must survive sample-size checks,
  alternative cost assumptions and genuinely untouched data.
- All orders remain disabled.

Next milestones: deeper resumable historical archives, background worker isolation,
walk-forward testing, persisted versioned research reports, order-cost sensitivity,
and comprehensive UI and PWA regression validation.
