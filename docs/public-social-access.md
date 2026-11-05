# Public markets and social accounts: release procedure

The production market dashboard and macro calendar can be read without an account. Journal, alerts, push subscriptions and saved markets require a signed Discord or X session. Research and stat-arb remain owner-only. The Northflank API still requires its existing gateway credential for **every** route, including public reads. The Vercel gateway sends a verified provider ID to the API only after it validates its own signed session; OAuth tokens never go to Northflank.

## Configure accounts without sharing credentials

Register confidential web applications with the providers and set these exact callback URLs:

| Provider | Registered redirect URI | Requested scope |
| --- | --- | --- |
| Discord | `https://fluxdesk-terminal.vercel.app/api/auth/callback/discord` | `identify` |
| X | `https://fluxdesk-terminal.vercel.app/api/auth/callback/x` | `users.read` |

Use X's Web App (confidential) OAuth 2.0 configuration. Keep provider client secrets and the new 32-byte-or-longer random session signing secret in Vercel's production-only sensitive/encrypted environment settings. Do not place them in source, chat, or a `VITE_` variable. Record the immutable numeric provider user ID for the account that owns the existing journal, using `discord:<id>` or `x:<id>` for `FLUXDESK_OWNER_SUB`. The provider's visible username is not a safe owner identifier. The owner must keep using that same provider to reach legacy journal, alerts, watchlist and push subscriptions. Discord and X identities are separate accounts; linking/migration is not implemented.

| Deployment | Configuration |
| --- | --- |
| Vercel production server | Existing `FLUXDESK_BACKEND_URL`, `FLUXDESK_GATEWAY_TOKEN`; `FLUXDESK_PUBLIC_MODE=true`; `FLUXDESK_PUBLIC_HOST=fluxdesk-terminal.vercel.app`; `FLUXDESK_SESSION_SECRET`; `FLUXDESK_OWNER_SUB`; `FLUXDESK_DISCORD_CLIENT_ID`, `FLUXDESK_DISCORD_CLIENT_SECRET`; `FLUXDESK_X_CLIENT_ID`, `FLUXDESK_X_CLIENT_SECRET` |
| Vercel production build | `VITE_FLUXDESK_PUBLIC_MODE=true` (public UI flag only; no credential) |
| Existing Northflank backend service | Existing matching gateway credential and durable `/data`; `FLUXDESK_PUBLIC_MODE=true`; same `FLUXDESK_OWNER_SUB` |

All listed Vercel keys are production scoped; secrets are production-only. Preview deployments remain protected and read-only against the shared backend. The backend and gateway **must both run the social access code** before setting either public-mode flag. The gateway refuses backend responses without `x-fluxdesk-access-mode: social-v1` when its public mode is on.

## Release order

1. Merge and deploy the tested alert and social access code while the existing all-deployment Vercel Authentication is still active. Verify the backend code version and volume are healthy. Do not turn on public mode during an older backend release.
2. Create both provider applications and configure the variables above in the provider dashboards. Complete the metadata-only preflight and confirm the owner ID through a provider sign-in (without inspecting journal contents). Redeploy the Vercel build after changing build variables. Switch the existing Northflank service to public mode in a short controlled window; then verify the Vercel gateway's social mode and its backend version marker.
3. While Vercel still protects all deployments, test a signed-out `/api/health` **before** `/api/markets`, then calendar and private-route denials through authorized fetch. Complete owner and friend sign-in callbacks. Check an owner journal HTTP success/status without copying its contents, a friend's empty account, alert creation/trigger/rearm, and cross-account denials. Verify worker and feed freshness independently before market reads.
4. Set Vercel Authentication scope to **Standard Protection** (`prod_deployment_urls_and_all_previews`). This opens the production domain to friends while retaining protection for preview and generated deployment URLs, including older deployments. Never set `ssoProtection` to null/None here. In a signed-out browser, verify public markets/calendar, private API 401, X and Discord sign-in, and owner-only routes. Check the metadata preflight again in its `live` phase.
5. If sign-in or isolation fails, restore **All Deployments** protection first, then revert the public-mode flags/deployment as needed. The gateway's mode marker rejects an older backend rather than exposing its responses.

The metadata check cannot inspect secret contents, Northflank settings, or OAuth callback registration. The production switch waits on those checks and on the provider application credentials; no credential values belong in a PR or chat.

Run `pnpm release:preflight metadata.json --social-staging` before the production switch and `pnpm release:preflight metadata.json --social-live` after Standard Protection is active. The JSON file contains only the project fields and environment-variable **metadata** accepted by `server/release-preflight.ts`, never values.
