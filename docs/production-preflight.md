# Production configuration preflight

The working canonical phone app is a protected Preview deployment. On 24 October 2026, Vercel metadata confirmed all-deployment Authentication and Node 24.x, but both `FLUXDESK_BACKEND_URL` and `FLUXDESK_GATEWAY_TOKEN` were Preview-only. No production entries were hidden. No secrets were decrypted or copied.

## Repeatable check

Run `pnpm release:preflight /path/to/metadata.json`. The file contains a `project` object with `id`, `name`, `accountId`, `nodeVersion`, and `ssoProtection`; an `envs` array containing only `key`, `type`, `target`, optional `gitBranch`; and `hiddenProductionEnvCount`. These correspond to Vercel project/environment metadata. Omit all credential values. The checker rejects inputs containing `value` or `decryptedValue` fields, symlinks and files over 256 KiB.

Exit 0 means configuration **metadata** passed, 1 means blockers, and 2 means invalid file/usage. It does not establish credential validity, secret uniqueness, upstream isolation, backend health, durability or release authorization. A production credential with its own target can still share the same underlying value; metadata cannot prove otherwise. Always inspect fresh authenticated provider metadata, not an old or edited snapshot. The project and team are pinned to this repository's known FluxDesk deployment.

## Remaining release sequence

1. Owner decision (24 October): retain the existing Northflank service, one instance and existing /data volume for production. No second service or compute upgrade. New Vercel Preview gateways reject every non-GET request; production retains writes. This prevents accidental preview mutations, not credential-level isolation from trusted deployment authors or older immutable deployments. The backend remains on its existing deployment branch until the release branch is switched explicitly.
2. Configure the production HTTPS backend origin and its matching strong gateway credential directly in the provider dashboards. Keep the production credential configuration production-scoped; the approved single-backend arrangement still uses that backend’s existing credential. Do not claim separate-backend credential isolation; never paste it into chat or a metadata file. Retain Preview settings for the accepted app.
3. Repeat the metadata check, then stage a production deployment without assigning the user-facing alias. Confirm all-deployment Authentication and direct-backend rejection of unauthenticated requests.
4. Verify the actual production gateway and durable-data path, including backup/isolated restore; do not infer this from Preview success or from the metadata check. Promote the tested production deployment only after those checks.

The CLI is an operational check, not a new deployment workflow. No production configuration or provider resources are changed by running it. Existing CI continues to verify application behavior; this check is not run against live credentials in CI.

References reviewed 24 October: https://vercel.com/docs/environment-variables and https://vercel.com/docs/deployments/promoting-a-deployment .


## Single-service production configuration receipt

On 24 October the owner authorized retaining the existing Northflank service. The known working branch-scoped Vercel backend URL and gateway secret objects were changed to Production-only targets with no secret-value reads. The generic Preview objects remain for read-only previews. Fresh redacted metadata passes the CLI check. Both production and preview health reads succeeded; production returned the existing 700-market feed, journal and scanner endpoints with HTTP 200. No journal entries were created or changed during this verification. The staged production build retained all-deployment Vercel Authentication; a logged-out request redirected to Vercel sign-in.

Automatic custom-domain assignment was disabled while staging. The accepted canonical alias is moved only after the release checks pass; deployment IDs, CI and final alias/merge status are recorded in PR #12. The existing Northflank service name, one instance, volume and approved storage allowance are retained. This is not separate-backend isolation. Keep the backend's feature branch as a frozen release branch until its provider Git setting is deliberately changed; future development must use another branch and must not auto-deploy backend changes to this live service.
