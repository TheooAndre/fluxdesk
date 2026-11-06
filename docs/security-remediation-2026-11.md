# November 2026 security assessment remediation

This change set addresses the actionable findings in the November 5 report and
its intrusive-pass addendum.

| Finding    | Resolution                                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01, F-05 | Enforcing CSP and Permissions Policy on every Vercel response. TradingView is allowlisted only for the owner investment widgets; frames remain sandboxed.                                                                         |
| F-02, F-08 | Gateway account/IP throttles, optional shared Upstash counters, backend display-name defense in depth, and end-to-end `Retry-After` forwarding.                                                                                   |
| F-03       | FluxDesk deliberately uses an unverified email as a sign-in identifier. Recovery requires a separately generated, hashed, one-time recovery code; the interface now states this explicitly. No email-based recovery trust exists. |
| F-04       | Removed the catch-all SPA rewrite, so unknown paths are real 404s. Added `robots.txt`, `sitemap.xml`, and RFC 9116 `security.txt`.                                                                                                |
| F-06       | Accepted informational exposure: detailed passive health remains public because the dashboard and external worker-stall monitor depend on it. It contains no credentials or user data.                                            |
| F-07       | The gateway never forwards backend CORS headers; a regression test proves a wildcard backend value cannot reach an API client.                                                                                                    |
| F-09       | Malformed authentication JSON is rejected with HTTP 400 at the edge and the backend.                                                                                                                                              |
| F-10       | No change. Idempotent unknown-alert deletion intentionally avoids an existence oracle.                                                                                                                                            |

The edge limiter defaults to an in-instance counter. Set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for exact counters
across Vercel instances. Storage errors degrade to the bounded local counter;
`FLUXDESK_RL_FAIL_CLOSED=1` instead rejects authentication until storage
recovers.
