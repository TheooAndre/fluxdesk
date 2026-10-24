# FluxDesk crypto trade journal

A separate Trade journal / mobile Journal workspace, persisted in `/data/journal.json` through the existing authenticated API. It works immediately with manual records and portable files. No account credentials, external SaaS subscription or new infrastructure is required.

The feature brief draws on the notes/tags, execution/cost analysis, performance reports and multi-account workflows described by TraderMake.Money and CoinMarketMan:
- https://tradermake.money/
- https://coinmarketman.com/features/automated-journaling/
- https://coinmarketman.com/features/tracking-and-analytics/

This implementation does not claim full parity with either service. Exchange API auto-sync, hosted screenshot uploads, public verification pages and AI coaching are not connected.

## Entries and daily workflow

- Dates default to the device's local calendar, with explicit date selection for both trade entries and daily plan/mood/review/lessons. Fill timestamps retain UTC offsets; the editor displays device-local times.
- Planned/open/closed trades, accounts, setup/timeframe, tags, mistakes, emotions, confidence and execution scores, rules-followed flag, thesis, invalidation, management plan, review and next actions.
- One to four legs per trade, linear USD/USDT/USDC perps or long spot, with up to 100 timestamped entry/exit fills per leg. Stop/target/leverage are recorded metadata. Inverse/coin-settled contract P&L is unsupported and must not be entered as if it were linear.
- Base quantities and USD-equivalent prices/costs. Chronological weighted average cost supports scale-ins, partial exits and subsequent additions. Exit quantities cannot exceed the open position. Leverage never multiplies P&L.
- Per-fill signed USD fees (negative means rebate), total signed funding (received positive / paid negative), other costs, planned risk and entry equity, optional **manually observed** MFE/MAE. Unrecorded fees/funding/excursions are not fabricated.
- Up to six HTTPS screenshot/chart references. Images are not fetched by the server or uploaded. Scanner candidates can seed unsaved pair drafts with direction, method context and hedge ratio; size/risk remain manual. Replacing an existing device draft requires explicit confirmation; declining preserves it.
- Device-local trade/daily drafts survive navigation and failed saves. Explicit reload-saved controls handle conflicts without silently rebasing or overwriting another device's changes. Closing the trade editor retains its device draft; discard is explicit. Successful saves clear corresponding device drafts.

## Accounting and analytics

Gross realized P&L is the sum over exited base units of signed price change from current average cost. Net recorded cash P&L = realized gross − all recorded fees + funding − other costs. Open/partial cash previews exclude unrealized P&L. Performance statistics include fully closed trades only; plans and remaining open exposure do not enter win rate/profit factor/expectancy.

Analytics include net P&L, win rate, profit factor, expectancy per trade, average R (requires recorded initial risk), average/best/worst wins/losses, discipline rate, fees/funding, cumulative closed-trade P&L and USD drawdown. The curve is ordered by final exit timestamp. It is **not account equity or deposit-adjusted performance**. No invented annualized Sharpe or MFE/MAE from fills.

Search/filter by date range, selected day, account, setup and status. Breakdown tables by instruments, setups, accounts, weekday, direction, tags, mistakes, emotions and discipline. Tag/mistake/emotion categories overlap and must not be added together. Calendar uses chosen journal date and all accounts; its count includes all statuses but P&L only closed trades.

## Durability, import/export and limits

- Atomic disk replacement and serialized mutations. In-memory success is not shown before disk replacement completes; failed requests do not poison later writes.
- Per-trade/daily revisions reject stale updates and deletes with HTTP 409. No last-writer-wins whole-journal replacement.
- Complete compact JSON export includes all trades, daily notes and revisions. Import is atomic and conflict-aware; matching IDs with identical content are skipped; differing IDs/dates conflict instead of overwriting. Imports keep original timestamps while creating local revisions.
- Generic single-leg CSV template supports dated entry/exit, quantity/prices, fees/funding/risk, account/setup/tags/notes. Deterministic row IDs make repeated identical CSV imports duplicate-aware. Vendor-specific CSV layouts require mapping; they are not guessed. JSON handles multi-leg/partial-fill records.
- Filtered CSV summary is spreadsheet-safe (formula-prefix escaping) and for analysis, not restoration. Full JSON is the portable restore format.
- 2000 trades, 3660 daily notes, 4 MiB stored journal / import. Trade and note mutations are bounded to 128 KiB; other API requests keep their existing 16 KiB limit. The journal stays below the gateway's 8 MiB response cap. JSON export is compact so a complete stored journal fits its import bound.
- The encrypted backup CLI now includes and validates `journal.json`. Existing pre-journal backups remain valid; take a new computer backup after saving journal data. The total encrypted archive source budget remains 16 MiB across all application data and datasets.

Endpoints: GET `/api/journal`; POST/DELETE `/api/journal/trades`; POST `/api/journal/day`; POST `/api/journal/import`. All use the existing gateway/origin protections. The single-owner journal is shared between the owner's authorized devices; it is not a multi-user brokerage account system.

## Open positions and review workflow

The **Open positions** view derives remaining units and cost basis from saved fills, including entries after partial exits. It uses the terminal's existing market snapshot without adding another poller. Exact-contract linear-perp quotes must be live, finite, positive, have a known last/mark basis, and be no more than 45 seconds old (at most 5 seconds ahead for clock tolerance). Offline, unknown, expired and spot quotes are unavailable; a perp quote is never substituted for spot. Timers and foreground/reconnect events refresh quote eligibility.

Estimated unrealized P&L is direction × remaining units × (quote − remaining average cost). Recorded cash and this estimate are separate, with their sum shown only if every open leg has a usable quote. Binance uses last-trade estimates and Hyperliquid mark estimates, labelled with the source timestamp basis. Neither is an executable fill or account equity. Unrecorded funding and future closing costs are excluded.

Cost-basis-to-stop risk sums remaining units × adverse distance from remaining average cost to the recorded stop, floored at zero per leg. Missing stops make the total incomplete. This is not current-market downside, margin/liquidation risk or an exchange stop order; it excludes fees, gaps and slippage. Leverage never multiplies these amounts.

The **Review queue** flags missing setup, plan or planned risk, missing stops on open legs, and missing review, lesson or execution rating for closed trades. Edit/save removes completed gaps through the existing revision-protected persistence path. A rule deviation can still have a complete review; completeness is not a strategy approval.

Closed analytics now include reviewed counts, first-entry-to-final-exit holding time, duration buckets and longest net win/loss streaks in final-exit order. Breakeven resets streaks. All journal filters apply to positions, queue and analytics; calendar remains all-account by journal date.

Accounting reference checked 24 October 2026: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/entry-price-and-pnl . Journal fee conventions remain explicit positive-cost/negative-rebate, with funding recorded separately.
