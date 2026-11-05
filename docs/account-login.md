# Persistent FluxDesk accounts

Email/password login uses Better Auth 1.7.17 and Node's built-in SQLite driver
on the existing Northflank `/data` volume. This single-process deployment needs
no extra Postgres service, database credentials, mail provider or paid auth
provider. Reconsider Postgres before adding multiple backend instances. Node
22.18+ or 24 is required; retain the existing one-instance volume.

## Access and configuration

Markets/calendar have an explicit public GET allowlist. Journal, saved markets,
alerts and push require a valid database session; research/stat-arb are owner-only.
Claimed identity headers are ignored in account mode. The gateway forwards only
the dedicated account cookie. Every direct Northflank route still requires
the existing gateway credential, including auth and public reads.

The Docker image enables `FLUXDESK_ACCOUNT_AUTH=true`. Vercel Production needs
`FLUXDESK_ACCOUNT_AUTH=true`, `VITE_FLUXDESK_PUBLIC_MODE=true`, and
`FLUXDESK_PUBLIC_HOST=fluxdesk-terminal.vercel.app`, plus the existing production
backend URL/gateway credential. Keep account/public flags Production-only.
The new gateway requires the backend's `accounts-v1` marker and fails closed
against older backends. OAuth is not used in account mode; no provider apps
or new credentials are required.

## One-time owner setup

The database reserves a random immutable owner ID before registration. Only
owner registration from the generated **Production deployment URL**, protected
by Vercel Authentication, may create that user. The gateway checks its actual
`VERCEL_URL` and `VERCEL_ENV`, then authenticates this assertion to the backend
with a short-lived purpose-bound MAC. The public domain, Preview deployments
and client-provided headers cannot claim ownership. There is no first-user-is-admin
rule and no role inferred from an email address.

Open the verified generated Production URL while signed into the owning Vercel
account. Its owner form asks for a display name, email and unique password of
at least twelve characters. Save the recovery code; do not send credentials in
chat. The reserved owner maps to existing journal/watchlist files and unassigned
legacy alerts/push records. Live records are not copied or reassigned to friends.

Normal registration stays closed until owner setup succeeds, even if public
markets are already open. New users then receive isolated empty workspaces.
Immutable account IDs are hashed for data directories; names/emails never
become paths. The small-service cap is one hundred accounts.

## Sessions and recovery

Better Auth hashes passwords. The host-only `__Host-fd-account` cookie has
Secure, HttpOnly, SameSite=Lax and Path=/, with no Domain. Signing into the
protected setup URL does not sign the browser into the separate canonical
domain. Sessions last seven days and are database-checked. Logout revokes the
server session. Mutations require the exact HTTPS Origin.

Database-backed rate limits and one concurrent password operation protect
the existing Sandbox budget. A separate signing purpose derives its key from
the strong gateway credential; neither key enters SQLite or the browser.
Gateway credential rotation invalidates old session cookies.

A random recovery code appears once after registration, password change or
recovery. Only its hash is retained. Emails are not asserted to be verified
and cannot by themselves reset a password or link social accounts. Recovery
requires email plus saved code, consumes it, resets through Better Auth, revokes
earlier sessions and issues a new code. No reset messages/tokens leave the server.
If both password and code are lost, self-service recovery is unavailable.

## Backup, release and rollback

Encrypted archives include a consistent SQLite snapshot with ownership,
hashed credentials and recovery-code hashes, plus per-user records. Sessions
and temporary rate counters are removed from the snapshot, preventing session
resurrection after restore. SQLite snapshots are bounded/integrity-checked
before isolated restore; live directories are never overwritten by restore.
Protect both the archive and its encryption password.

Run the metadata checker with `--accounts-staging` before rollout and
`--accounts-live` afterward. Staging protects all Vercel URLs. Live uses
**Standard Protection** (`prod_deployment_urls_and_all_previews`): the canonical
domain is public, while generated production URLs and previews, including the
owner setup URL, stay protected. Never select None. Verify passive worker
progress before markets, then public reads, account status and anonymous private
401 responses. Actual owner credentials are always chosen by the owner;
owner/friend creation, recovery and restart/backup use synthetic CI records.

Before rolling back to any legacy backend/frontend pair, restore all-deployment
Vercel Authentication first. Do not expose a legacy single-user gateway/backend
on a public domain. Keep all account/journal files on the same volume; never
delete the database to retry setup.
