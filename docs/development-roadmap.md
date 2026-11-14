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
| 1   | BLS schedule         | Exact calendar URL and application headers returned HTTP 403 from the released Northflank container on 14 November. Backoff and working fallback expose the stale source. Diagnose supported access or replace the source. |
| 2   | Push delivery        | Durable per-device outbox, bounded retry/expiry, acceptance/failure visibility and stable notification tags released. Physical iPhone installed-PWA resume and a test push still need owner device. |
| 3   | Offsite restore      | Required state files are present on the existing /data volume. Real encrypted export to owner computer, checksum and isolated restore remain unverified. Northflank volume UI showed no native backups. |
| 4   | Main protection      | Active main ruleset 27268519 verified by authenticated API readback: PR, up-to-date quality and Offline stat-arb mechanics checks, resolved conversations, no force-push/deletion, no bypass. |
| 5   | Float / FDV          | Hourly batched CoinGecko observations released; fresh/stale/unknown states exclude unsupported dynamic membership. Production had 30 fresh venue-specific rows and 659 unknown at release. |
| 6   | Macro latency        | First observed actual and trigger times; delivery outcomes; provider forecast separate from consensus. Upstream free feed can cache for 15 minutes.                                                                                         |
| 7   | Advanced scan health | Oldest evaluation, delayed/unchecked/error counts; many-account synthetic queue/concurrency test. No tick-level latency guarantee.                                                                                                          |
| 8   | Auth throttles       | Production metadata has no shared Redis settings. Local edge plus database backend limits remain. Cross-instance/shared-storage tests and missing-config fail-closed behavior implemented; optional Redis configuration awaits owner setup. |
| 9   | Stock resilience     | Parallel quote/fundamental/news requests; retained exact-identity quote marked stale on refresh failure; stale quote cannot verify a new link. No new paid provider.                                                                        |
| 10  | Compact alerts       | Search and Active/Triggered/Paused filter; expandable device diagnostics and paged trigger history.                                                                                                                                         |
| 11  | Acceptance           | Final-head CI passed 523 tests, lint, TypeScript, smoke/build, browser/mobile, persistence/auth and audits; frontend/backend release verified. Physical iPhone installed-PWA and test push remain. |
| 12  | Roadmap              | Current checklist separated from historical receipts here. Track CI, PR and deployment evidence in the release PR.                                                                                                                          |

## Administration handoff

Main protection is active: [ruleset 27268519](https://github.com/TheooAndre/fluxdesk/settings/rules/27268519) targets `main` without bypass actors. An authenticated GitHub API readback confirmed the PR, strict up-to-date `quality` and `Offline stat-arb mechanics` checks, resolved conversations, force-push and deletion restrictions. It requires no second human reviewer for this solo-owner repository. The source definition is `deploy/github/main-ruleset.json`.

Northflank's existing service is running the released revision with its original 6 GB `FD Storage` volume. Recent startup logs showed a Node SQLite experimental warning, not a failed request. Direct calendar retrieval from that host still returned HTTP 403; the fallback is live. A presence-only check found the required state files; their contents were not opened. The volume UI listed no native backups.

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

Repository protection is verified. The encrypted owner-computer backup, checksum and isolated restore receipt, BLS supported-source resolution, and physical iPhone PWA/push checks remain open until actual evidence is recorded.

## Research remains separate

Strategy Lab empirical work still needs audited historical membership, payable
funding and publication timing. These are research prerequisites, not website
availability blockers. Keep the final holdout closed while qualifying inputs.
