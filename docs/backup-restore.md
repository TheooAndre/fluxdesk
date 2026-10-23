# Encrypted backup and isolated restore

The application archive tool backs up `state.json` (alerts, events and push
subscriptions), `watchlist.json` and up to 100 immutable research datasets.
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
- Schedule/retention and the offsite destination are not configured yet.
- Local automated tests demonstrate encrypted round-trip, original dataset-ID
  preservation, wrong-password/tamper rejection, expansion limits, symlink and
  path protection, and refusal to overwrite existing data. They do not establish
  that a backup of the owner's Northflank volume has been made or restored.
