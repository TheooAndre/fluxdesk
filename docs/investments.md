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

## Verified stock data

Adding a stock starts with company/ticker search. Choose the exact Yahoo Finance
listing (exchange and symbol suffix included); FluxDesk verifies its identity,
stock/ETF type, currency and price before linking. `marketSymbol` is optional for
backward-compatible imports. Existing manual entries use **Link listing** once;
no company-name guess silently attaches another exchange or an ADR. Changing
listing fields clears the link. The selected company, listing and currency are
filled automatically; a missing issuer country is labelled Unknown.

The same market pane serves every linked China/global stock: timestamped quotes,
six-month daily history, market cap, valuation ratios, dividends, analyst targets
and consensus, company profile and stock-specific headlines. **Overview**, **News**
and **Company** keep this compact. Owner theses/statuses remain manual; publisher
news and analyst opinions do not overwrite research or become a generated thesis.

All provider calls run on the existing authenticated backend. Only search text and
listing symbols reach Yahoo; portfolio weights, notes, broker links and account
identifiers do not. Anonymous provider cookies/crumbs stay process-local. Routes
`/api/investments/search?q=...` and `/api/investments/stock?symbol=...` inherit the
owner-only checks. New links are verified on save, with a maximum of 20 distinct
new links per request. Editing existing notes needs no provider call.

This uses Yahoo's public, unofficial endpoints without an API key or a paid
subscription. Availability and exchange delays apply. Quotes refresh at most
once per minute; search/news/fundamentals use bounded process-local caches.
The quote time and native currency are always displayed. Missing fundamentals,
failed news and failed quote refreshes are shown explicitly. The backend never
substitutes another listing, currency-converted quote or fabricated metric.
