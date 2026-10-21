# FluxDesk v0.2 — implementation and validation

Date: 19 October 2026. Continued from the existing `fluxdesk-crypto-dashboard.zip` v0.1.

## Outcome

The existing dashboard is buildable and its partial-feed/error paths have been hardened. This is a self-hosted, read-only research application. No production host was created and no trading performance or execution capability was validated.

## Verified in this environment

| Check | Result |
| --- | --- |
| Dependency installation | Passed after declaring missing `workbox-window` and allowing the pinned esbuild dependency's normal build script. Lockfile included. |
| TypeScript | `tsc --noEmit`: passed, including frontend, server, tests and feed-verification script. |
| Unit and HTTP integration tests | 39 passed across 6 files. HTTP tests use temporary loopback listeners and mocked upstream responses. |
| Dependency-free smoke suite | 8 passed. |
| Production React build | Passed. |
| Service-worker / PWA build | Passed; generated `dist/sw.js` and install manifest, with 13 precache entries. |
| Compressed application JavaScript | 88,434 bytes across both generated JS chunks, below the 200,000-byte target. Excludes CSS, images, service worker and network/API overhead. |
| Runtime used | Node 24.19.0; installation used pnpm 11.25.0. The project retains its Node 22–24 range and pnpm 10.18.0 declaration; Node 22 and a fresh pnpm 10 install were not independently executed here. |

Expected 400-response messages appear in HTTP-test stderr for deliberately invalid requests. They are not failing tests.

## Live public-feed evidence

- Hyperliquid `metaAndAssetCtxs`: HTTP 200; 178 non-delisted, valid default-DEX market rows at inspection. Counts change over time.
- Hyperliquid BTC mark-price/open-interest conversion returned a finite observed value. No account or trading credentials were used.
- Hyperliquid BTC all-interval scan: 13 of 14 intervals completed successfully with 180 valid closed candles each (`1m,3m,5m,15m,30m,1h,2h,4h,8h,12h,1d,3d,1w`).
- Hyperliquid monthly candles use provider-reported boundaries in the inspected response. That response contained a missing period between the candle ending 2021-07-01 23:59:59.999 UTC and the next candle opening 2021-08-01 00:00 UTC. Validation withheld `1M` analytics instead of joining across the gap. This is a point-in-time observation, not a claim that all future monthly responses are invalid.
- Binance public REST: HTTP 451, with the venue's restricted-location response from this host. Binance live candle, OI and liquidation operation therefore remain unverified. The application reports this state and can still display the reachable venue.

A successful connection verifies transport and input checks; it does not verify exchange completeness, predictive accuracy, a profitable strategy or a stationary pair.

## Main corrections

1. Fixed undefined variable in asset selection; switching from Binance `6h` to Hyperliquid resets to supported `1h`.
2. Fixed service-worker request typing and missing PWA dependency that blocked the full build.
3. Added venue-specific recent/stale/unavailable status, original successful-fetch timestamps and bounded stale-display expiry. Fresh-only market lists feed alerts and correlation discovery.
4. Added bounded request caching and concurrent-call coalescing; candle refresh failures never serve expired history as if newly fetched.
5. Reject malformed OHLCV, negative/missing volume, invalid close boundaries, duplicate/missing bars and obsolete completed candles. Scanners distinguish insufficient history and fetch failures from zero detected candidates.
6. Added direction/model filters, explicit scan failure details and market-table pagination beyond the previous 160-row cutoff. Unknown OI always sorts after known OI.
7. Matched reported OLS beta to the causal fit for the current z-score; rejected invalid OU half-life interpretations. Included the two earliest eligible MSB pivots and corrected EMA rule wording without a tuning sweep.
8. Distinguish unavailable/disconnected liquidation observations from zero. Show whether Binance's observation window is fully collected.
9. Removed stale market-API service-worker responses and deferred background alert creation; offline support now covers the app shell and already displayed in-memory views.
10. Added cancellable, time-bounded client reads and stronger API method/input checks.

## Not completed or claimed

- Browser rendering, interaction/accessibility and Lighthouse runs: not executed; the browser-control capability required by the environment's Sites workflow was unavailable. Existing Playwright mocks were updated for the new response shape, but those tests were not run.
- Physical iPhone install, Web Push delivery, background delivery and offline/reload behavior: not device-tested.
- Remote CI, dependency audit, production OIDC/TLS, hosted deployment and licensed calendar integration: not completed.
- Binance-wide OI ranking and Hyperliquid market-wide liquidation accounting: still not implemented.
- The four entry models remain unvalidated candidates. No historical performance, profitable edge, holdout result or permission to transmit exchange orders follows from this release.

## Reproduce

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:smoke
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. The archive includes the built `dist/` directory, but runtime dependencies still need installation. Use the original README's HTTPS/authentication deployment instructions for external access; do not expose the Node service unauthenticated.

Run `pnpm verify:feeds` to inspect the current environment's public venue availability and an available BTC all-interval scan. It intentionally exits nonzero on any blocked venue or incomplete interval. This does not ask you to bypass a venue restriction.

## Protocol references checked

- Binance official USDⓈ-M market data: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data
- Hyperliquid official info endpoint and supported intervals: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- Hyperliquid official perpetual metadata: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals

Documentation establishes the endpoint contracts; the live results above came from actual public requests in this run.
