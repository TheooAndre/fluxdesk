# Free BLS schedule replacement — 16 November 2026

The direct BLS ICS endpoint returned HTTP 403 from the existing production backend.
The replacement is the New York Fed Economic Indicators Calendar:
https://www.newyorkfed.org/research/calendars/nationalecon_cal

No subscription, API credential or paid infrastructure is required. Its Terms of Use
allow automated access and personal/business redistribution with attribution:
https://www.newyorkfed.org/privacy/termsofuse

The adapter selects the same four schedule families as before: CPI, PPI,
Employment Situation and JOLTS. It converts Eastern wall times with DST, follows
the published next-month link when the 14-day window crosses a month boundary,
and fails visibly on stale pages, challenges or changed markup. The existing
HTTP 403 backoff and source diagnostics remain. Requests use the shared calendar
cache (normally ten minutes); no BLS endpoint is fetched by this adapter.

The UI and returned events include the New York Fed attribution and terms link,
and explain FluxDesk's selection/time conversion. This is a schedule feed.
Existing ShowMyTrades actual/consensus/previous data and its latency limitations
remain; these values are never invented from the schedule.

Alternatives reviewed: XOOMAR is already integrated and supplies no consensus;
FRED requires a key and its release-date API lacks release times; Finance Calendar
requires a key with a limited free quota. New York Fed supplies the needed four
release schedules directly from an established public institution. Its HTML layout
is a dependency, covered by shape validation and failure states.

Validation: lint, TypeScript, 524 unit/API tests and production build passed.
A direct HTTP 200 request and parser run against November 2026 returned JOLTS
(Nov 3, 15:00Z), Employment Situation (Nov 6, 13:30Z), CPI (Nov 10, 13:30Z),
and PPI (Nov 13, 13:30Z). A current Nov 16 request validly returned zero selected
releases in the upcoming 14 days. Empty selected coverage is not an outage.
Production-host verification is recorded in the PR after rollout.
