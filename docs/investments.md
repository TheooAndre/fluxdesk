# Owner investment thesis workspace

The Investments tab is restricted to the actual owner account. The backend
checks the immutable owner ID for every `/api/investments` request. Display
names never grant access. Anonymous requests receive 401; friend accounts
receive 403 even if they copy an owner name or submit identity headers.

The workspace supports multiple investment theses and listings from any
country or exchange. Each stock has an explicit listing currency, economic
theme, target weight, manual review status, thesis, catalysts, invalidation,
risks, metrics, dated notes, research sources and optional broker/reference links.
There is no broker connection, execution, automatic recommendation, price-derived
status change, or inferred portfolio P&L. Target weights are research allocations;
the unallocated target is not an observed cash balance.

## Original China dashboard

The owner can import the original MCGA HTML dashboard or a FluxDesk investment
JSON export. The importer reads the embedded JSON stock array without executing
the HTML. It preserves original listing/reference identities, target weights,
qualitative statuses and stock memos, and marks the research as 19 October 2026.
Imported broker eligibility, valuations and headlines are historical claims
requiring review. The China thesis remains separate from additional global theses.

Private holdings, allocations and notes must never be committed to the public
repository or embedded into frontend assets. Import is an authenticated owner
action. Duplicate thesis IDs are rejected; existing edits are not overwritten.
The original source artifact is retained unchanged.

## Persistence and market references

Data is stored in `investments.json` on the existing persistent volume, with
bounded validation, serialized atomic writes and whole-workspace revision checks.
Conflicting saves return 409 and retain the editor. Reloading does not erase
an open stock draft. Archive/restore preserves stock notes. Limits: 20 theses,
250 stock records across theses and 1 MiB total. Active weights cannot exceed
100% within a thesis. Listings remain distinct across exchanges/currencies.

Encrypted backup/restore includes and validates the investment file. Private
queries use no-store responses and are removed when the owner session ends.

TradingView chart/news widgets load only after the owner's explicit button
click, in sandboxed frames. Only the chosen reference symbol goes to the vendor;
notes and weights are not supplied. Reference quotes may use a different
listing/currency and vendor delays/coverage apply. Research statuses remain
manual. CSV exports neutralize spreadsheet-formula prefixes.

Validation uses synthetic portfolios and accounts. Do not create real owner
credentials or alter journal records for deployment checks.
