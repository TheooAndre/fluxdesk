# Historical data acquisition — 25 October 2026

Status: source qualification in progress; **not an audited, engine-ready market dataset**. No empirical research, selection, backtest or holdout evaluation has been run. The preregistered protocol and parameters remain unchanged.

## Fixed scope

Start with Binance USD-M, USDT-settled crypto-native linear perpetuals, 4h trade candles. Intake window: **2024-09-01 00:00 UTC inclusive through 2026-10-01 00:00 UTC exclusive** (760 days). This scope is fixed before strategy analysis. Hyperliquid data are a separate venue and cannot be pooled to fill Binance gaps.

The initial source-qualification pilot requests BTCUSDT, ETHUSDT, FTMUSDT, LINAUSDT and LUNAUSDT. Two reference instruments and three historical/lifecycle cases test the pipeline, including absence and post-termination records. They were not selected by correlation, cointegration, z-score or profitability. **These five instruments are not the research universe.** Expanding only to today's survivors would violate the research protocol.

## Sources and evidence

| Source | What it supports | What it does not establish |
| --- | --- | --- |
| Official Vision monthly 4h klines with publisher SHA-256 sidecars | Download integrity, trade OHLC/base volume/quote volume, observed timestamp continuity | Complete historical tradable universe or immutable contract/incarnation identity |
| Official monthly fundingRate archives | Original `calc_time`, `funding_interval_hours`, `last_funding_rate` observations | Every actual payable funding settlement, interpretation after termination or ticker reuse |
| Official daily metrics files, sampled on month-start days for the pilot | Timestamped historical `sum_open_interest_value`, source symbol and diagnostics | Complete weekly PIT membership, historical 24h volume, or coverage between sampled days |
| Official paginated archive indexes for klines/fundingRate/metrics | Archive-wide discovery including historical prefixes and Unicode symbols | Listing/delisting timestamps; crypto-native/linear contract classification; contractual completeness |
| Tardis public exchange availability metadata | Second catalogue for coverage questions and availability comparison | `availableSince` as a listing timestamp or best-effort metadata as a complete lifecycle audit |
| Binance funding REST history | Potential reconciliation against archive observations when legitimately accessible | A successful response or empty array alone as proof of complete settlement history |

Direct Binance `exchangeInfo` and historical `fundingRate` probes returned HTTP 451 in this runtime. No alternate host, proxy location or geography change is used to bypass it. Public archive access is independently available. Restricted REST access remains a documented missing cross-check; it is never interpreted as zero funding.

Tardis's normalized `derivative_ticker` funding fields refer to **upcoming** events and variable rates. Do not treat their last pre-event quote as a settled funding payment. Paying for tick data does not automatically solve the settlement-population audit.

## Reproducible collection

Standard library only; no brokerage credentials or strategy imports:

```bash
python3 research/statarb/collect_public.py inventory --out /path/to/intake
python3 research/statarb/collect_public.py collect --out /path/to/intake \
  --start 2024-09-01 --end 2026-10-01 \
  --symbols BTCUSDT,ETHUSDT,FTMUSDT,LINAUSDT,LUNAUSDT
```

The collector is a bounded qualification tool, not a venue-wide bulk downloader. It permits 2–20 explicitly named ASCII pilot symbols, 1–4 workers, globally paced requests, a 25-second request timeout, 32 MiB source-object limit and 256 MiB capture budget. Inventory preserves non-ASCII prefixes; their contract mapping must be reviewed before a later full export.

Each successful HTTP body and its URL/UTC receipt/status/length/hash/selected response headers are saved under `raw/`. Original ZIP and checksum bytes are retained. Every archive's declared digest, filename, exact CSV member, decompression bound and CRC are checked before parsing. Existing captures are hash-checked and reused; the command does not silently replace pinned originals or retry restricted/missing sources. A changed provider version or failed-capture retry requires a separate capture directory and an explicit reconciliation. Do not run two collectors against the same directory concurrently.

`observations/bars` preserves source base and quote volumes. `observations/funding_rates` labels the archive calculation observations as unverified settlements. `observations/metrics_month_start_days` preserves the sampled metric rows. Gaps, duplicate timestamps, zero-volume bars and malformed metrics stay visible; they are not forward-filled, deduplicated, normalized into another ticker or removed to improve results.

`source-audit.json` remains **blocked** even if all received ZIP checksums match. It does not create `funding/`, `membership.csv`, a manifest with true coverage assertions, or an engine-ready dataset. Exit zero means the collection command completed, not that the audit passed. A missing file is unknown coverage, not a certified prelaunch/post-delisting interval.

## Lifecycle checks

Use the futures section of dated official announcements. A spot delisting date is not a perpetual settlement timestamp:

- FTMUSDT: official announcement specifies automatic settlement **2025-01-06 09:00 UTC**, with new positions blocked at 08:30. The FTM spot cessation is 13 January, a different event. Do not stitch FTM and S into a continuous tradable contract without a documented mapping and execution model.
- LINAUSDT: automatic futures settlement **2025-03-27 09:00 UTC**, new positions blocked at 08:30. The spot delisting is 28 March.
- LUNAUSDT: treat as a historical identity/availability control; do not substitute LUNA2, LUNC or BUSD collateral histories based on name resemblance.
- Public repository issue #495 reports a different LITUSDT ticker-reuse case. It is a third-party issue report, not an exchange certification; it motivates explicit incarnation checks rather than automatic data corrections.

## Required gates before research

1. Freeze a complete historical crypto-native USDT linear-perp universe with immutable instrument/underlying identities and effective listing, close-only, settlement, delisting, migration and reuse records. Reconcile archive and vendor catalogues; explain missing symbols and preserve each exclusion reason.
2. Obtain the payable funding-event population or effective historical settlement calendars, with interval changes, UTC anchors, exceptions and first/last events. Reconcile observations against this expected population and document source corrections. Preserve event type and distinct same-timestamp payments.
3. Obtain sufficient historical OI and 24h quote-volume observations to construct full PIT snapshots no more than seven days apart, using observations available no later than each decision. Sparse pilot metrics do not pass this gate.
4. Provide actual account-tier maker/taker fee evidence, dated, including relevant discounts and applicability. The engine's existing generic 4 bps assumption is not the owner's verified fee tier. Slippage/participation still require a separate documented model and validation.
5. Produce a versioned canonical export with a full file-hash manifest; run the existing structural preflight. Its current 200-history/512 MiB bounds must be reviewed before a larger universe, never worked around by silently truncating symbols. Only set coverage assertions true after documented independent review.
6. Freeze data and trial genealogy before development walk-forward. The chronological final 30% holdout remains unevaluated. Obtaining and structurally checking bytes is not permission to select pairs on the holdout.

A vendor coverage statement is evidence to verify, not an automatic audit pass. Full independent certification and positive edge have not been established. Unavailable/corrupt histories cannot be replaced by synthetic fills, today's universe, zero funding or forecast funding quotes.

## Source references

- https://github.com/binance/binance-public-data — formats, checksums and corrections.
- https://data.binance.vision/ — public original objects and indexes.
- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data — funding time/event fields, pagination and OI retention.
- https://www.binance.com/en/support/announcement/detail/aec6fcbc84b749eeab6690e6bcac2f3d — FTM futures versus spot lifecycle.
- https://www.binance.com/en/support/announcement/detail/db7ad1c7aa6248cda735102cdcdc4b8d — LINA futures versus spot lifecycle.
- https://github.com/binance/binance-public-data/issues/495 and /issues/517 — unresolved public coverage/identity questions; not official answers.
- https://docs.tardis.dev/api/instruments-metadata-api — metadata lifecycle/availability caveats and access requirements.
- https://docs.tardis.dev/downloadable-csv-files/data-types#derivative_ticker — upcoming funding semantics.
- https://docs.tardis.dev/faq/billing-and-subscriptions — paid history entitlements and sample limitations; no purchase made.
- https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md — current dataset licence; intake is for personal non-production research, not a production feed. Retain attribution and applicable terms with any retained/derived data.
