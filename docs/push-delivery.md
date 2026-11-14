# Push delivery receipts

A trigger and its per-device outbox are committed atomically to state.json. Only
hashed endpoint identifiers appear in event diagnostics. Subscriptions and their
keys remain in account-scoped storage and are never copied into receipts.

Four workers process up to 40 pending devices per drain; a ten-second timer also
runs with no active alert rules. A device is claimed on disk before transport.
429, 5xx and transport failures retry at most three times within five minutes,
respecting Retry-After and exponential delay. Permanent errors fail; 404/410
remove expired subscriptions. A deleted/transferred subscription cannot receive
another account's queued event. Older events without an outbox are never replayed.

An interrupted claim after restart is marked outcome unknown and is not resent.
This deliberately avoids replay after an ambiguous accepted send. Transport
retries retain the event ID; the service worker uses it as a notification tag,
replacing an existing notification without renotifying. This reduces duplicate
visible notifications but cannot promise exactly-once delivery to a device.

“Accepted” means the push service accepted the request, not that the device
received or displayed it. Missing VAPID configuration, no devices, permanent
failures, retry exhaustion and expiry remain visible. No delivery payload contains
owner investment or journal data. Retention follows the existing bounded event
history; this is not a guaranteed-delivery queue or an unlimited audit log.
