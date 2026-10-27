# Encrypted backup and isolated restore

The application archive tool backs up `state.json` (alerts, events and push
subscriptions), `watchlist.json`, `journal.json` and up to 100 immutable research datasets.
It excludes environment files, credentials, temporary files and provider volume
identity. Dataset filenames and SHA-256 fingerprints are verified before backup
and again before restore. Archives use AES-256-GCM, a random salt/nonce and a
scrypt-derived key; plaintext archive files are never written.

This is an operator CLI, not a public HTTP endpoint. Run it in an authorized
checkout with filesystem access to the **actual backend data directory**, or
against a securely exported copy. The existing Northflank instance and its
persistent volume are unchanged by implementing this tool.

The backend image also includes `scripts/archive-cli.ts`. In an authorized
provider shell use `node --import tsx scripts/archive-cli.ts` instead of
`pnpm archive`; its arguments and password-file requirements are identical.
Use a provider-authorized export mechanism to move the encrypted file off the
instance. No provider login, transfer or recurring schedule is configured here.

## Create and verify

Create a private password file outside the git checkout, with mode `600`,
containing a long unique password (a password manager can generate/store it).
Do not reuse the gateway token. The password is read from a file rather than
passed in command arguments or environment variables, and is never logged.
Keep a separate recoverable password-manager copy: an archive cannot be
restored without it.

```sh
pnpm archive backup /path/to/backend-data /secure/fluxdesk-2026-10-23.fdbackup --password-file /secure/backup-password
pnpm archive verify /secure/fluxdesk-2026-10-23.fdbackup --password-file /secure/backup-password
pnpm archive restore /secure/fluxdesk-2026-10-23.fdbackup /secure/isolated-restore --password-file /secure/backup-password
```

The restore directory must **not exist**. The tool validates every entry before
creating it, rejects path traversal/symlinks, writes private files, and never
merges into or overwrites the live data directory. Existing output archives are
also never overwritten. Verify the reported dataset IDs against the original
Strategy Lab archive. The restored files can be validated without starting a
second backend, which would otherwise duplicate alert/push activity.

For disaster recovery, stop the live writer and use the provider's offline
volume procedure to install the verified application files. Retain the target
provider's mount identity and environment secrets separately; neither belongs
in this application archive. This CLI intentionally does not automate replacing
a live cloud volume.

## Scope and limits

- Passive backups capture atomic state/watchlist files and immutable datasets
  individually; they are not a global transaction across all resources.
- The bounded tool supports a 16 MiB uncompressed manifest/source budget and
  100 datasets. An oversized or corrupted archive fails instead of producing a
  partial backup. Larger archives require a separate streaming-volume backup.
- Copy the encrypted `.fdbackup` file to an independent offsite destination;
  keeping it only on the same volume does not provide disaster recovery.
- Destination selected by owner: an encrypted copy on the owner’s computer.
  Transfer and recurring scheduling are not configured yet.
- Local automated tests demonstrate encrypted round-trip, original dataset-ID
  preservation, wrong-password/tamper rejection, expansion limits, symlink and
  path protection, and refusal to overwrite existing data. They do not establish
  that a backup of the owner's Northflank volume has been made or restored.


## Owner computer workflow (selected 23 October 2026)

The website continues running without a downloaded backup. The computer copy
protects against loss of the hosted volume and counts as offsite because it is
on a separate machine. No cloud-storage subscription is needed.

1. Create the encrypted archive in an authorized Northflank service shell,
   using the real `/data` directory and the CLI included in `/app`. Use a private
   password file outside `/data` and outside the checkout; keep its recoverable
   password-manager copy on your computer. Never send the password in chat.
2. Verify the encrypted archive on the host. Download the `.fdbackup` through
   a provider-authorized secure transfer into a private folder on your computer.
   Do not expose `/data` or add a public download route. The Vercel connection
   does not grant access to Northflank's filesystem.
3. Compare the archive SHA-256 on the host and your computer. On macOS use
   `shasum -a 256 /path/to/file.fdbackup`; on Linux use `sha256sum`.
   A matching transfer checksum does not replace archive verification.
4. In a checkout of the matching FluxDesk revision on your computer, run the
   `verify` and `restore` commands above, supplying your local password file and
   a new restore directory. Compare the reported dataset IDs with Strategy Lab.
   Do not start a second backend against the restored files.
5. Retain the verified encrypted file and its checksum. Remove temporary host
   archives/password files after transfer and successful local verification.
   Keep the live `/data` files untouched.

Suggested manual cadence: after important dataset/watchlist changes and before
hosting changes; keep the latest three verified backups until a retention policy
is chosen. This is guidance, not an installed scheduler. Terminal layout or
TradingView preferences stored only in the browser are not in this server backup.

The owner verified the original hosted backup and isolated computer restore on
23 October. That receipt predates the journal. A fresh archive including current
journal records still needs host export, download and isolated computer restore;
local fixture tests do not clear that new-data recovery check.
