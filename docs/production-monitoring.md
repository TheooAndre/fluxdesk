# Production health watch

An hourly read-only health watch was enabled on 27 October 2026 through the owner's connected Vercel account. It checks the canonical protected app's health, market feed freshness, liquidation connection and calendar source availability. It reports confirmed actionable problems and recovery, and distinguishes expired monitoring access from application outages. An empty calendar alone is not an incident. It does not access journal entries or change production.

This is hourly polling, not continuous uptime coverage or a delivery SLA. In-app quote age and feed status remain the immediate indication of stale data. Authentication must stay enabled. Never publish monitoring credentials or share links.

28 October: the watch now reads passive `/api/health` before `/api/markets`, so
the monitoring request cannot refresh quotes before checking the background
worker. It checks the worker's running flag, 10-second interval, positive cycle
count, recent start/completion timestamps and actual venue freshness. Suspect
progress is rechecked once after 20 seconds using health only. A completed cycle
without fresh venue data is not healthy. Runtime-log queries use a 30-minute
window within the free plan's retention; a failed logs query is not a clean scan.

The Node 24 `DEP0169` warning was traced on an authenticated preview to the
platform's lazy `request.query` getter (`/opt/rust/nodejs.js`), invoked from
`apiPath` in the gateway. The gateway now parses raw query strings with `URL`
and checks only explicitly supplied query data properties, avoiding the legacy
getter while retaining conflicting/duplicate route rejection. A preview-only
`NODE_OPTIONS=--trace-deprecation` override was used for diagnosis; do not enable
or suppress warnings globally in production.

For an incident, confirm the response and source timestamps, check the affected deployment's runtime logs, and distinguish a failed request from Node deprecation output. Preserve the previous working deployment for rollback. A successful health endpoint alone does not prove every venue or feature is healthy.

The next recovery action requires the owner's computer: export and verify a fresh encrypted archive containing journal.json, download it, compare SHA-256, and restore to a new isolated folder. Follow backup-restore.md; do not overwrite the live volume or start a second alert worker.

Historical research remains independently blocked on payable funding, historical contract identity/membership and publication timing. The owner-supplied maker/taker fees are already recorded. No final holdout or strategy ranking is authorized by operational health checks.
