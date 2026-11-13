# Calendar sources and recovery

The public calendar checks Trading Economics (when configured), ShowMyTrades,
Finance Calendar (when configured), BLS, BEA and XOOMAR in parallel. Selection
follows that order, with the two official schedules combined as the final fallback.
The free ShowMyTrades feed supplies analyst consensus, previous and actual values;
a provider's separate model forecast is retained separately when supplied.
A valid empty window is available, not an outage. Per-source `sources` includes
status, `checkedAt` and event count; `staleSources` lists attempted failures.
Optional providers without credentials are `not_configured`.

Requests have a nine-second deadline and share one in-flight refresh. The normal
cache is ten minutes. While a release alert is active and an event is within two
minutes before / six hours after its scheduled release without an actual value,
the scanner can refresh after thirty seconds. The scanner runs about once a
minute; delivery depends on the provider publishing data and is not an exchange
latency guarantee. Failed whole-calendar refreshes back off at least a minute in
release mode. Other consumers continue sharing the same cache.

If every source fails, earlier events are retained for at most two hours on the
same UTC day and explicitly marked stale. Stale rows cannot trigger macro alerts.
Failure messages never copy arbitrary exceptions or credentials. Untimed,
cancelled, invalid and out-of-window releases are omitted. No dates or values are
fabricated. Official schedule backups do not supply numerical actual/consensus
values and therefore cannot themselves produce an actual-value release alert.

## Macro notifications

New macro rules default to **When actual data is released**. They wait for a
non-placeholder numerical actual, reject future, stale and more-than-six-hour-old
releases, and ignore releases scheduled before the rule was activated. A release
message contains actual, analyst consensus, previous, and a distinct provider
forecast if available. Missing consensus/previous values are labelled explicitly.
It never substitutes the forecast for the actual or sends a release countdown.

**Before release** sends one reminder at 5/15/30 minutes, 1/2/4/12 hours, or one day
before the event. Create separate rules to receive both a reminder and the actual.
Existing saved rules without `timing` remain advance reminders. Repeating rules
continue across events; one-shot rules disable after their first event. Per-rule
bounded deduplication is persisted atomically, including simultaneous releases,
and survives process restarts. Reactivation begins a new monitoring window.

## Optional Finance Calendar access

On 5 November 2026 the anonymous endpoint returned HTTP 401 with code
`api_key_required`. The provider's current reference requires an account key.
Its product page advertises Starter access, while some older pages still
describe Free accounts. Check the account's actual entitlement and price;
no purchase or signup is needed for FluxDesk's public schedule backups.

If an existing account has access, create/manage its key directly with the
provider. Configure `FLUXDESK_FINANCE_CALENDAR_API_KEY` **only in the existing
Northflank API service's private runtime variables**, then deploy/restart that
service. The request uses the documented `X-API-Key` header, rejects redirects,
and never puts the key in a URL or browser bundle. Do not paste keys in chat,
commit them, add a `VITE_` prefix, or copy them into Vercel's frontend variables.
Normal caching performs up to 144 refreshes/day per active process. Active release
alerts refresh pending observations more frequently near release; account quotas,
other clients, restarts and previews must also be considered.

Read `/api/calendar` to verify the `financecalendar` entry in `sources` is `live` after setup.
A 401/403 requires correcting the key or account permissions; 402 requires a
provider entitlement decision, and 429 requires respecting its quota.
Do not retry anonymously or disable dashboard authentication to fix it.

## Provider checks

For backend releases, read passive `/api/health` before requesting markets.
Confirm worker progress with two reads at least twenty seconds apart, then
check `/api/calendar` for per-source statuses and actual event attribution.
Do not infer Northflank reachability from a successful laptop request.
A BLS 403 is a runtime-origin access rejection, not a missing BLS API key;
the iCalendar subscription is public. The HTTP client identifies itself as
FluxDesk and does not attempt to bypass access controls.

Sources reviewed 5 November 2026:

- https://www.financecalendar.com/api/reference/
- https://www.financecalendar.com/api/
- https://www.bls.gov/help/hlpical.htm
- https://www.bea.gov/news/schedule/icalendar
