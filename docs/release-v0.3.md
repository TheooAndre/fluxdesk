# FluxDesk v0.3 release acceptance record

**Date:** 22 October 2026  
**Repository:** TheooAndre/fluxdesk  
**Pull request:** [#11](https://github.com/TheooAndre/fluxdesk/pull/11)  
**Release scope:** single-user, research-only market dashboard and Strategy Lab.

## Automated verification

[GitHub Actions CI #188](https://github.com/TheooAndre/fluxdesk/actions/runs/39759300561)
completed successfully after the local HTTPS proxy regression fix.

- pnpm install, lint, TypeScript, Vitest and smoke tests: passed
- Production build and per-chunk gzip bundle budget: passed
- Playwright browser tests: passed (27 tests, 3 expected skips)
- Lighthouse mobile PWA shell quality assertions: passed
- Production dependency security audit: passed

The test suite includes explicit same-origin HTTPS proxy coverage and verifies
that foreign-origin mutations remain blocked. Mocked market-data tests prove
UI and API behavior, **not** historical quote authenticity or future returns.

## Owner-performed physical-device acceptance

The owner reported **Pass** on all seven local acceptance checks:

1. Strategy Lab tab opens and layout fits an iPhone screen
2. Historical BTC candles download successfully
3. Saved dataset appears in the historical archive selector
4. Backtest executes and produces a research report
5. Equity curve, trade log, and warnings display correctly
6. Installed PWA launches offline and Strategy Lab interface opens
7. Live data and archive access recover after reconnection

These are *owner-reported checks*, not remotely witnessed test recordings.
The local network environment and exchange access may differ after deployment.

## Research interpretation and non-goals

v0.3 is **not a validated profitable trading system**. Existing four patterns
are signal **candidates**. Simulation uses completed OHLC candles, next-bar
fills, pessimistic same-bar stop-first ordering, risk-based position sizes and
configurable trading-cost estimates. The holdout is chronological but not a
locked, one-time statistical test; repeatedly inspecting and adjusting rules
against holdout results contaminates the evaluation.

The research engine does not model funding payments, market impact, leverage
limits, dynamic order book depth, partial fills, exchange minimum quantities,
latency, liquidation risk or intratrade equity drawdown. Sample-size warnings
are mandatory. No live exchange orders, credentials or execution endpoints
exist in the release.

## Deployment and data safety

- The API is designed for a **single process** using local JSON storage.
  Archive files under `DATA_DIR/research/datasets/` and alert state in
  `DATA_DIR/state.json` require persistent backups on any permanent host.
- A local HTTPS Mac preview on port 4183 is for **trusted LAN testing only**.
  Do not port-forward it or expose port 8787 directly.
- Public cloud deployment is **not part of v0.3**. It requires authenticated
  access (HTTPS/OIDC), durable storage, a persistent backend for Binance
  WebSocket/alert scans and an appropriate backtest worker/job design.
- The Binance liquidation stream reports partial snapshots and should not
  be interpreted as exhaustive venue-wide liquidation flow.
- An archived dataset's SHA-256 digest establishes integrity against
  accidental mutation, **not** independent verification of exchange prices.

## Follow-up milestones

- Authenticated remote/cloud deployment, with separated static frontend and
  durable always-on backend.
- Longer, reproducible, resumable historical data archives and provenance.
- Walk-forward evaluations, untouched final holdouts, bootstrap uncertainty
  bands and sensitivity to realistic fees/funding/slippage.
- Persisted backtest reports and non-blocking background research workers.
- Actual paper-trading order execution model, *after* credible evidence of an
  economically significant edge.

Release readiness means **the local research dashboard works as scoped**.
It does not approve automatic market execution or publication of the API.
