# Calendar sources and recovery

The calendar is available without buying a data subscription. The persistent
API checks XOOMAR and the official BLS and BEA schedules in parallel, with a
nine-second deadline per request and a ten-minute process cache. Status is
reported per source in `sources`, including `checkedAt` and the number of
selected events in the next fourteen days. A valid empty window is available,
not an outage. `staleSources` lists attempted sources that failed; an optional
provider without credentials is separately `not_configured`.

Finance Calendar, when configured and successful, takes precedence. Otherwise
the attributed XOOMAR schedule is preferred for its broader US coverage.
If both broad feeds fail, the available official schedules are combined.
BLS covers CPI, employment, PPI and JOLTS; BEA covers national GDP, personal
income/outlays (including PCE) and international goods/services trade.
Official backups do not supply consensus or prior values and do not cover
every agency. Release times are parsed from the source; untimed, cancelled,
invalid and out-of-window releases are omitted. No dates are fabricated.

If every source fails, earlier events are retained for at most two hours on
the same UTC day and explicitly marked stale. Failure messages never copy
arbitrary upstream exceptions or credentials. Concurrent refreshes share a
single fetch; failed responses are also cached to avoid retry storms.

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
The cache performs up to 144 refreshes/day per active process; other clients,
restarts and previews can add requests against the same account quota.

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
