# FluxDesk development checklist

Updated 14 November 2026. This is the current checklist. Earlier release receipts
are retained in [development history](development-history-2026-11-14.md).

## Current product

Public markets and macro calendar; database sessions for private alerts, journal
and saved markets; owner-only investments and research. The existing single
Northflank instance and volume serve the Vercel production frontend. Keep that
backend and account isolation when releasing; do not expose the gateway secret.

Shipped: searchable asset/benchmark pickers; overlapping categories; global stock
listing lookup; TradingView charts/news; 1–50-leg journal baskets, Lite mode and
manual close/reopen; one-shot/repeat price/range rules; macro actual-value and
advance alerts; 32-family multi-condition advanced alerts; installed-PWA push.

## 14 November reliability work

| #   | Work                 | Current state / completion gate                                                                                                                                                                                                             |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLS schedule         | Direct host access returns 403. Backoff retains the true failed check and working fallback. Repair/replacement remains open; no recovery is claimed.                                                                                        |
| 2   | Push delivery        | Durable per-device outbox, bounded retry/expiry, acceptance/failure visibility and stable notification tags implemented. Requires CI and production backend rollout.                                                                        |
| 3   | Offsite restore      | CLI now supports required accounts/investments as well as journal. Real export, owner-computer download and isolated restore still require administrator access.                                                                            |
| 4   | Main protection      | Ready-to-apply ruleset in deploy/github/main-ruleset.json; administration access required. Require quality and Offline stat-arb mechanics checks; solo owner does not need another reviewer.                                                |
| 5   | Float / FDV          | Hourly batched CoinGecko observations for explicit identities; fresh/stale/unknown states; stale/unknown excluded from dynamic membership. Requires backend rollout; identity coverage is intentionally partial.                            |
| 6   | Macro latency        | First observed actual and trigger times; delivery outcomes; provider forecast separate from consensus. Upstream free feed can cache for 15 minutes.                                                                                         |
| 7   | Advanced scan health | Oldest evaluation, delayed/unchecked/error counts; many-account synthetic queue/concurrency test. No tick-level latency guarantee.                                                                                                          |
| 8   | Auth throttles       | Production metadata has no shared Redis settings. Local edge plus database backend limits remain. Cross-instance/shared-storage tests and missing-config fail-closed behavior implemented; optional Redis configuration awaits owner setup. |
| 9   | Stock resilience     | Parallel quote/fundamental/news requests; retained exact-identity quote marked stale on refresh failure; stale quote cannot verify a new link. No new paid provider.                                                                        |
| 10  | Compact alerts       | Search and Active/Triggered/Paused filter; expandable device diagnostics and paged trigger history.                                                                                                                                         |
| 11  | Acceptance           | Full automated browser/device matrix required before merge. Physical iPhone installed-PWA resume and a test push require owner device participation. Use synthetic accounts and records for automated tests.                                |
| 12  | Roadmap              | Current checklist separated from historical receipts here. Track CI, PR and deployment evidence in the release PR.                                                                                                                          |

## Administration handoff

GitHub connector operations do not grant repository-administration privileges.
After signing into the owner's GitHub account, create a branch ruleset from
`deploy/github/main-ruleset.json` in repository Settings → Rules. The required
contexts must match actual successful CI jobs. An administrator may alternatively
apply it from an authenticated GitHub CLI with:

```
gh api --method POST repos/TheooAndre/fluxdesk/rulesets --input deploy/github/main-ruleset.json
```

The prepared rule blocks deletion and force-push, requires a PR, resolved review
threads and the two CI jobs. It does not require a second human reviewer for this
single-owner repository. Verify the applied rule using fresh GitHub metadata.

Shared authentication throttles are optional infrastructure. No shared-store
credentials were read or created. The present fallback policy retains service
availability with bounded local counters and independent backend database limits.
Set `FLUXDESK_RL_FAIL_CLOSED=1` only when deliberately accepting authentication
unavailability if shared configuration/storage is absent or fails.

## Release and recovery

Run the full CI, stage the production frontend, and deliberately fast-forward
the backend's frozen feat/cloud-foundation-v0.4 branch to the verified revision.
Confirm passive health cycles advance over 20 seconds before requesting markets.
The backend health version `reliability-2026-11-14` identifies this rollout.
Verify canonical alias, public reads, anonymous private rejection and account
metadata without reading owner journal contents. Keep the previous deployment
for rollback and follow the account-auth rollback rules. See production-preflight.md.

The real backup/restore receipt, repository-admin configuration and physical
phone checks remain open until actual evidence is recorded; code/tests alone
cannot mark them complete.

## Research remains separate

Strategy Lab empirical work still needs audited historical membership, payable
funding and publication timing. These are research prerequisites, not website
availability blockers. Keep the final holdout closed while qualifying inputs.
