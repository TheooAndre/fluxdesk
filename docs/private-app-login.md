# Private FluxDesk login without a Vercel account

This is a single-owner password login, not a multi-user account system. The Vercel gateway authenticates every API route, including reads and health, before adding the backend credential. Login endpoints execute locally on Vercel. Neither the owner password nor the session cookie is sent to Northflank.

## Safe cutover

1. Keep Vercel Authentication on all deployments while preparing and testing this release.
2. In Vercel's production environment, set `VITE_FLUXDESK_APP_LOGIN=true` and a unique `FLUXDESK_APP_PASSWORD` of 20–256 bytes. Use a password manager to generate at least 32 random characters. The password must be encrypted/sensitive, production-only, server-only, and never use a `VITE_` prefix. Do not store it in Northflank, git, chat or screenshots.
3. Redeploy production: the public flag is needed at build time and both values at function runtime. A preview can use separate test credentials; never copy the production password into previews.
4. While the outer Vercel wall is still active, verify the FluxDesk login screen, rejection of unauthenticated API calls, correct login, logout and expiry. Private records need not be read to test authentication; use `/api/health`.
5. Only after verification, change Vercel Authentication to protect previews and deployment URLs while allowing the production domain. Verify a new signed-out browser sees the FluxDesk login, can sign in without a Vercel account, and cannot access API routes before signing in. Keep deployment previews protected.
6. Adapt the existing health watch before cutover: it currently uses Vercel authorized fetch, which does not provide a FluxDesk session. A protected read-only preview with app login disabled can monitor the same backend using its existing Vercel protection. It must retain the preview mutation ban and use the same deployed backend. Also check the production login/session endpoint without credentials. Never place the app password in automation prompts or URLs.

## Session behavior and limits

- Host-bound `__Host-` cookies are Secure, HttpOnly and SameSite=Strict, with an eight-hour expiry. Password rotation invalidates all existing sessions.
- Logout removes the current browser cookie and clears in-memory query data, with notification to other tabs. It does not revoke a copied/stolen cookie; rotate the password to revoke all sessions.
- Mutations, login and logout require a same-origin request. Signed cookies are checked on every private request; a client-side UI change cannot grant access.
- Password checks use scrypt and timing-safe comparison. Bound request sizes, bounded concurrent derivations and a five-attempt-per-minute per-instance client-IP limiter reduce abuse. Vercel instances do not share rate limits; this is not a globally enforced lockout. Use a strong generated owner password. Add a shared rate limiter before offering multi-user or weak-password accounts.
- API responses are not cached by the PWA service worker. An expired session unmounts private screens and clears the query cache when the API returns 401.
- With the feature flag enabled, missing or short passwords fail closed. With it disabled, the old Vercel-protected behavior remains; disabling the flag must never coincide with disabling Vercel Authentication.
- This change does not rotate the potentially exposed Northflank gateway token or fix the Northflank incident. Track that remediation independently.
