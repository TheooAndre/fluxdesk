# Production configuration preflight

The working canonical phone app is a protected Preview deployment. On 24 October 2026, Vercel metadata confirmed all-deployment Authentication and Node 24.x, but both `FLUXDESK_BACKEND_URL` and `FLUXDESK_GATEWAY_TOKEN` were Preview-only. No production entries were hidden. No secrets were decrypted or copied.

## Repeatable check

Run `pnpm release:preflight /path/to/metadata.json`. The file contains a `project` object with `id`, `name`, `accountId`, `nodeVersion`, and `ssoProtection`; an `envs` array containing only `key`, `type`, `target`, optional `gitBranch`; and `hiddenProductionEnvCount`. These correspond to Vercel project/environment metadata. Omit all credential values. The checker rejects inputs containing `value` or `decryptedValue` fields, symlinks and files over 256 KiB.

Exit 0 means configuration **metadata** passed, 1 means blockers, and 2 means invalid file/usage. It does not establish credential validity, secret uniqueness, upstream isolation, backend health, durability or release authorization. A production credential with its own target can still share the same underlying value; metadata cannot prove otherwise. Always inspect fresh authenticated provider metadata, not an old or edited snapshot. The project and team are pinned to this repository's known FluxDesk deployment.

## Remaining release sequence

1. Choose the production backend/data boundary. The only existing service is the staging Northflank service; a separate backend has not been provisioned or cost-approved. Do not silently share production state with ongoing preview development.
2. Configure the production HTTPS backend origin and its matching strong gateway credential directly in the provider dashboards. Use a distinct production-only credential; never paste it into chat or a metadata file. Retain Preview settings for the accepted app.
3. Repeat the metadata check, then stage a production deployment without assigning the user-facing alias. Confirm all-deployment Authentication and direct-backend rejection of unauthenticated requests.
4. Verify the actual production gateway and durable-data path, including backup/isolated restore; do not infer this from Preview success or from the metadata check. Promote the tested production deployment only after those checks.

The CLI is an operational check, not a new deployment workflow. No production configuration or provider resources are changed by running it. Existing CI continues to verify application behavior; this check is not run against live credentials in CI.

References reviewed 24 October: https://vercel.com/docs/environment-variables and https://vercel.com/docs/deployments/promoting-a-deployment .
