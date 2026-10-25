# FluxDesk development list

Updated 25 October 2026. Research only; no order execution or claimed predictive edge.

## Current milestone: v0.4 cloud terminal

| Item | State | Evidence / remaining work |
| --- | --- | --- |
| Vercel frontend and authenticated persistent Node API | Existing service retained for production | Northflank `fluxdesk-api-staging`, existing Default project, one Sandbox instance, `/data` volume; production environment/alias evidence tracked in PR #12 |
| Historical fetch and Strategy Lab | Owner accepted | Dashboard and historical research work remotely |
| Archive persistence through real service restart | Owner accepted | Archive reloaded and dataset SHA-256 matched |
| Faster exchange snapshots | Owner accepted | Foreground 10s polling, coalescing, venue backoff; explicit original ages retained |
| Shorter address | Owner accepted; authenticated API verified | `https://fluxdesk-terminal.vercel.app/` redirects logged-out visitors to Vercel SSO. Reconnected Vercel access now returns the current prerendered build and HTTP 200 for health, markets and saved favorites |
| Price basis, timestamps, live funding and price premium | Owner accepted on phone; automated checks pass | Last trade vs mark labels, exchange vs receipt ages, same-basis comparisons, Binance interval metadata and hourly Hyperliquid funding |
| Full CI | Improvement CI #352 passed at `b26bef5` | All application and Python jobs passed: 272 unit/API tests, 137 browser cases (3 intentional skips), 8 production cases, production-only container dependencies, 256 MiB persistence/restore, Lighthouse and runtime audit. Both staging deployments succeeded; final-alias shell asset matches the verified build. Owner confirmed all improvement-pass phone checks passed on 24 October. |
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
| Historical funding / mark archive | Hosted enrichment verified | Binance enrichment creates a new immutable fingerprint; exact mark-bar alignment, bounded funding pagination, signed payment rates and source/timestamp metadata. Encrypted backup/restore tested. Payment completeness is explicitly unaudited; engine v2 excludes these data; optional exploratory v3 now includes observed payments and mark-close equity, deployed and owner-accepted. Hyperliquid mark/oracle and PIT universe remain outstanding. |
| PWA update discovery | Owner reports all iPhone checks passed 24 October | Resume/reconnect checks, five-minute foreground checks, manual Check for updates. Update now still requires user action; no forced reload. |
| Price range alerts | Owner reports all iPhone checks passed 24 October | Lower/upper bounds validated and persisted; outward sampled crossings send direction-specific messages. Independent 5-minute boundary cooldowns; approximately 60s scans and first-observation arming. Automated API/scanner/browser checks cover persistence and both directions |
| Push notification subscription controls | Owner accepted enable/disable and locked-phone push | Owner configured VAPID; real iPhone enable/disable, locked-phone notification receipt and tap-to-open all passed. Diagnostic push transport was tested separately from market-rule evaluation |
| Remote iPhone PWA acceptance | Resume, offline shell and reconnect owner-passed | Installed app background/resume, airplane-mode reopen/offline indication and fresh-data recovery on reconnect passed. Locked-phone notification receipt and tap-to-open passed. Owner reports all iPhone checks passed on 24 October; no additional phone gate requested for this batch |

## New requested work: scanner and trade journal

| Item | State | Evidence / remaining work |
| --- | --- | --- |
| Venue/timeframe stat-arb scanner | Owner accepted on iPhone; CI #348 and staging passed | All supported current live venue assets attempted; every aligned unordered pair tested, ±2 z-score view, permissive/selective presets, progress/cancel/failures, JSON export and journal handoff. [Method and limits](statarb-scanner.md) |
| Persistent crypto trade journal | Owner accepted on iPhone; CI #348 and staging passed | Dated multi-leg fills, fees/funding, plans/reviews/tags/emotions/mistakes, daily notes, calendar/analytics, conflict protection, JSON/CSV import/export and encrypted backup inclusion. [Journal guide](trade-journal.md) |
| Free macro calendar | Keyless provider integration; pending production acceptance | Replaces paid Trading Economics key with Finance Calendar's high-impact US API, links to sources and credits, labels estimates/stale data; selective coverage and no consensus feed. Forex Factory redistribution is prohibited by its published notices. |
| Grouped iPhone acceptance for new workspaces | Owner confirmed working on 24 October | Owner reported “is working on the phone” after the grouped scanner/journal acceptance request. This records owner-reported device acceptance; no additional automated live scan result or market edge is inferred. Earlier accepted checks do not need repeating |

## Next work in order

1. The cloud terminal, scanner and journal are released on the protected production domain. PR #12 completed the v0.4 release; PR #13 released the chart/UI fixes as v0.4.1. Existing Northflank service/volume retained. Older staging and preflight sections below are historical receipts, not current release blockers.
2. Owner acceptance of all previous iPhone batches is complete. Group future device checks after several changes. Keep manual computer backups current after important journal/archive changes; the first owner-verified archive predates the journal.
3. Empirical research still needs actual audited two-year point-in-time universe/funding histories and owner account-tier fee evidence. Hyperliquid historical mark/oracle ingestion remains unconnected; its documented archive is requester-pays. Do not run the final holdout while selecting data or adapting research. Exploratory v3 observed funding/mark accounting does not certify historical completeness.
4. Intrabar margin/liquidation simulation remains outside the research engine. Implementing it requires a documented venue/account margin model and appropriate historical observations; do not infer liquidations from bar-close equity.
5. Continue evidence-based reliability and usability improvements. The v0.4.2 batch below addresses asynchronous journal saves, alert persistence recovery, liquidation connection ownership and request/delivery deadlines. Full CI and deployment receipts belong in its PR.

## Live funding conventions

- Binance table prices are last trades. The selected-contract panel fetches mark/index separately; price premium is `(mark / index - 1) × 100`.
- Binance `/fapi/v1/fundingInfo` supplies adjusted payment intervals. A symbol absent from a valid response uses the documented 8h default; failed/malformed metadata leaves the interval unknown. Metadata refreshes every minute.
- Hyperliquid contexts supply mark/oracle and the hourly funding rate. Price premium is `(mark / oracle - 1) × 100`, not the exchange's separately defined funding premium field. Next payment time is explicitly a schedule estimate.
- Positive reported funding means longs pay shorts; negative means shorts pay longs. Rates can change before payment. No annualized return or guaranteed carry is shown.
- Hyperliquid contexts do not contain an exchange quote timestamp. The UI labels server receipt time explicitly. Failed refreshes retain original ages and are labelled stale/unavailable.
- Live funding is a terminal display only. Default v2 backtests exclude it; optional exploratory v3 uses archived historical payments and mark closes with explicit coverage limitations.

Primary references consulted 23 October 2026:

- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data
- https://www.binance.com/en/support/faq/detail/360033525031
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding

## Owner checks needed before release

- General phone UI acceptance is complete as of 23 October; the new scanner/journal workspaces were owner-confirmed working on 24 October after their grouped test request. Vercel access and final-alias automated feature/mutation checks pass.
- Cross-client save/reload/remove was verified in authenticated live QA; original favorites were retained.
- Installed iPhone background/resume, offline reopen and fresh-data recovery on reconnect are owner-passed. Locked-phone push receipt and tap-to-open are owner-passed. Owner reports all iPhone checks passed on 24 October.
- Actual hosted encrypted backup, matching computer download and isolated local restore are owner-completed. Archive SHA-256: `5cc39e2e462b8696ad1f5e222b9b445cb0d8e8521dfeb2cadc735ac47a79cef0`; 7 files / 6 matching dataset IDs. Keep the encrypted copy and recoverable password-manager entry. Repeat backups manually after important changes; no recurring scheduler is installed. See [backup/restore runbook](backup-restore.md).

## Current batch: exploratory accounting and report portability

- Opt-in v3 consumes archived signed funding and historical mark closes; default v2 replay stays unchanged. Missing/misaligned history fails.
- Reports include funding P&L per trade, mark-based bar-close equity and conservative ordering disclosures. Intrabar margin/liquidation and historical payment completeness remain outside its claims.
- JSON report download includes engine version, configuration, dataset receipt/fingerprint, trades, equity and warnings.
- Synthetic tests cover signs, equity/cash reconciliation, entry ambiguity, intrabar stops, gap exits, future payments, sample boundaries, legacy mode and stored-runner versioning. No actual market backtest/holdout was run by the agent.
- Grouped iPhone acceptance passed: v3 controls/report workflow, funding coverage panel and the tested download checks. No additional phone action is required for the read-only offline audit tool.

## Funding coverage diagnostics

Observed regular/unspecified spacing, leading/trailing window gaps, long gaps over an explicit 8h review threshold, rate signs/types and maximum absolute mark/trade close difference are derived from validated immutable snapshots. Special payment events do not imply scheduled payments. Results always require review; no missing payments, historical schedules or completeness percentage are inferred. Verbose spacing/gap lists are bounded while total counts are retained. Diagnostics travel with dataset receipts and JSON report exports; suspicious boundaries/gaps add v3 report warnings. Original dataset fingerprints remain unchanged.

Grouped phone checks are owner-passed; CI #340 and both deployments succeeded.

## Offline research input audit

Implemented a standard-library-only preflight for real historical exports. Reports manifest/fee evidence, UTC/4h bar validity, funding formatting, PIT snapshots, missing historically active market histories, two-year union span and 180-day overlap. Inputs are size-bounded, symlinked files fail, issues are aggregated and file/content hashes include the manifest. No strategy imports, parameter search, research run, file writes or holdout access. Structural success never certifies external completeness or trading readiness.

Remaining inputs before empirical market validation: actual audited two-year PIT/funding data and owner account-tier fee evidence. Hyperliquid mark/oracle history remains unconnected. Intrabar margin/liquidation simulation is still outside the current engine. Terminal release/promotion remains separate from these research-data gates.

## Improvement pass (24 October 2026)

- Scanner: versioned device preferences, ranking/direction controls, candle-close age, progress bars, shared settings validation, precomputed asset log prices and bounded binary insertion. Statistical method and permissive selection rules remain unchanged. A 2,500-pair retention test matches the prior stable ranking.
- Journal: Open positions with remaining cost basis, last/mark quote estimates and recorded-stop risk; stale/offline/unsupported quotes and incomplete multi-leg totals are excluded. Review queue links into revision-protected editing. Closed analytics add holding duration, review completion and net streaks. No new database schema or owner-data migration is needed.
- Server image: tsx is a runtime dependency; a separate production-only install replaces the full build/test dependency tree in the runtime image. CI asserts that build/test tools are absent before running its existing 256 MiB persistence and encrypted restore checks. Full development audit reports are retained as CI artifacts alongside the enforced runtime audit.
- Local validation: lint/types, 272 unit/API tests on Vitest 5.0.5, 8 smoke tests and production build passed. Full desktop/mobile Chromium suite passed 55 cases (one intentional skip); after the final build-tool changes, all eight focused scanner/journal cases and four production hydration/chart cases passed. The real journal HTTP-to-disk save/reload passed on desktop and mobile. Mobile screenshot reviewed. A production-only offline install successfully imported the API/archive modules and could not resolve build/test tools. Full hosted CI #352 passed at `b26bef5`, including 137 five-browser cases (3 intentional skips), 8 production cases, container persistence/restore and Lighthouse. Both staging deployments succeeded. Authenticated shell/health/journal/scanner reads returned HTTP 200; live shell asset `/assets/index-pToljRYh.js` matches the local build. Live journal records were not modified.
- Tooling migration: Vite 6.4.5 security maintenance release, Vitest 5.0.5, PostCSS 8.5.31, concurrently 9.2.5 and compatible transitive security updates, followed by fresh build/tests/audits. Node requirements now match the test runner: 22.12+ or 24 LTS. This is a supported maintenance update, not a claim that every library is on its newest major. Validation and staging deployment passed; evidence is recorded in PR #12.
- Dependency audit after updates: runtime zero advisories; full development tree 10 advisories (6 high, 2 moderate, 2 low; zero critical), down from 36. Remaining build/test dependency findings require upstream/major-tool migrations; they are excluded from the production-only image and retained in the CI audit report. No blanket clean audit is claimed.
- Grouped iPhone acceptance: owner reported “all phone tests passed” on 24 October. Scanner saved views/freshness, Open positions/offline estimates, Review queue saving and additional analytics are accepted; no repeat device gate is requested.

Current primary references checked: https://vite.dev/releases, https://vite.dev/guide/migration, https://react.dev/versions, https://vitest.dev/guide/migration/ , and https://hyperliquid.gitbook.io/hyperliquid-docs/trading/entry-price-and-pnl . Hyperliquid documents historical asset contexts at https://hyperliquid.gitbook.io/hyperliquid-docs/historical-data ; the archive is requester-pays with incomplete/tardy coverage possible. No paid archive was downloaded.

Remaining research gates: actual audited two-year point-in-time universe/funding histories and owner account-tier fee evidence; no market holdout or empirical edge claim. Major-toolchain migration and production-environment preflight/promotion remain separate from this staging improvement batch.


## Production configuration preflight (24 October 2026)

Completed a metadata-only inspection of the actual Vercel FluxDesk project/team and canonical alias. Authentication is enabled for all deployments; runtime is Node 24.x. The alias points to a ready feature-branch Preview deployment. The two backend settings exist for Preview (including branch overrides), with **no Production entries and no hidden Production entries**. Promotion remains blocked on production configuration, rather than device acceptance.

Added `pnpm release:preflight <metadata.json>`: a bounded, read-only checker of redacted project/environment metadata. It fails closed for the wrong project/team, missing protection, unsupported runtime, incomplete metadata, missing/ambiguous production settings, public or branch-scoped settings, and a cross-environment production credential. Reports never reflect credential values. It does not fetch providers, mutate environments or authorize release. See [production preflight](production-preflight.md).

Actual metadata returned two blockers: missing production `FLUXDESK_BACKEND_URL` and `FLUXDESK_GATEWAY_TOKEN`. Existing Preview configuration was not changed or decrypted. Configure production backend/credential privately, with a separate production credential and an explicit backend/data-isolation decision before release. Then verify a staged production deployment through its real gateway, durable data and backup/restore before promoting. Existing preview phone acceptance does not certify a newly configured production environment.


## Single-service release decision

Owner chose to retain the existing Northflank service on 24 October. No second backend, storage migration or compute upgrade. Production configuration can reuse the existing working branch-scoped Vercel environment objects by changing targets without reading secret values. The preview gateway now rejects non-GET requests to prevent accidental changes to shared owner data. This is an application guard, not isolation from trusted deployment authors or old immutable deployments. Production build/gateway verification and canonical-alias assignment remain required before claiming release complete.


## v0.4 release configuration

Owner approved retaining the existing Northflank service. Production URL/credential metadata is now configured, without decrypting secrets; the preflight passes. The production-target build has authenticated HTTP 200 shell, health, markets, journal and scanner reads and rejects logged-out shell access via Vercel sign-in. Preview gateways reject non-GET requests; this is an application guard on deliberately shared infrastructure. Release label/package are v0.4. Existing service/volume and storage allowance are retained; no second service, migration or compute upgrade. Final release CI, canonical alias and merge outcome are recorded in PR #12. Older staging receipts above remain historical evidence.

## Project checkup — 25 October 2026

Chart price-reference mismatch traced to closed trade candles versus current last/mark snapshots. Added a shared quote overlay without rewriting OHLC; stale/offline/unknown quotes are withheld. Closed-candle cache revalidates/refetches at interval boundaries; detail payload identity is checked and detail polling stops on unrelated workspaces. Long general notes are collapsed under labelled help, while data errors and core price/research labels remain visible. Production browser artifacts no longer erase development traces. See [checkup report](project-checkup-2026-10-25.md) for scope, evidence and remaining limits; hosted CI/release evidence is tracked in the new PR.

## Reliability improvements — v0.4.2

- Journal save receipts clear only the submitted device draft. Edits made during a save are retained and rebased onto the returned server ID/revision, including when leaving and reopening the workspace. A different trade/date draft stays intact. Pending journal writes remain visible to a newly mounted workspace; no automatic mutation retries. Reload actions preserve edits made while refresh was pending and do not replace drafts with stale cached data after a failed refresh.
- Alert/event/subscription changes are serialized against the last committed state. Memory changes only after atomic file replacement; a failed write neither consumes a cooldown nor poisons later updates. Unrecorded price/volume observations are restored so the next scan can retry after disk recovery. Renewed push subscriptions can update encryption keys at the same endpoint. Removed alert observations are pruned from scanner memory.
- Liquidation stream startup is idempotent. Retired sockets cannot change replacement connection state or add events; failed/stalled handshakes reconnect after a bounded wait. Invalid sides, prices, quantities and timestamps are rejected. Alert persistence/delivery failures are caught.
- Every browser API request has a deadline and tolerant HTTP error parsing. Timed-out mutations warn that server completion is uncertain and require refresh/check before another attempt. Push transport has a 10-second inactivity timeout and four delivery workers, so a stalled endpoint does not serialize all other devices. Delivery remains best-effort; no new retry queue or guaranteed delivery is claimed.
- Regression coverage includes delayed-save navigation/day switching, real HTTP journal persistence, disk-write failure/recovery, cooldown races, rotated subscription keys, old-socket events, handshake timeout and API cancellation/error handling. No owner journal records or historical research data were changed by tests.

Primary references reviewed: https://tanstack.com/query/latest/docs/framework/react/guides/mutations , https://nodejs.org/docs/latest-v24.x/api/globals.html#class-websocket , https://github.com/web-push-libs/web-push#sendnotificationpushsubscription-payload-options . No new dependency or paid service was added.

## Historical data acquisition — 25 October 2026

Started a fixed-window Binance public-source qualification intake (2024-09-01 inclusive to 2026-10-01 exclusive). Paginated archive-wide discovery includes historical and non-ASCII prefixes; a five-instrument source pilot includes lifecycle controls, not a research universe. Added a standard-library checksum/receipt collector and offline integrity tests. Funding archive calculation rows remain observations; no canonical funding/PIT dataset or true coverage assertion is produced. Direct REST cross-checks returned HTTP 451 in this runtime, recorded without bypass. See [acquisition protocol](historical-data-acquisition.md) for independent evidence gates, lifecycle sources, fee evidence and remaining full-universe work. No market research/holdout run, new paid source, cloud storage or deployment.

### Fee input and coverage-request decision

25 October: account-specific fee evidence is recorded privately, and the proposed Binance message was declined. Research CLI consumes manifest taker evidence before fingerprint/simulation; synthetic defaults remain preserved. The original data-capture audit stays immutable; a private amendment updates fee readiness while preserving all remaining funding/PIT/lifecycle/OI-volume blockers. No market run or holdout evaluation.

25 October, population amendment: owner approved skipping FTM/LINA and other instruments with unusable histories. Added a versioned, source-backed whole-instrument exclusion ledger honored by preflight and real loader; missing active histories without explicit exclusions still fail. Policy/fee metadata now participate in the engine input fingerprint. Reports disclose a retrospective data-quality subset and survivorship/availability bias; original full-market preregistration remains recorded separately. Retained instruments still need audited funding and historical membership/OI/volume. Original captures and blocked audit remain immutable; no market/holdout run or hosted deployment.

Next retained-asset data step: separate checksum-verified weekly BTC/ETH daily metrics and 24h quote-volume observations, with source ordering/label diagnostics and a nominal funding-grid diagnostic. Historical publication latency, source label semantics, actual payment population and contract identity remain unverified. No canonical membership/funding export or market/holdout evaluation is implied by an observed grid.
