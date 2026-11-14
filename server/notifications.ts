import webpush from 'web-push';
import type { AlertEvent } from '../src/types.ts';
import { snapshot, claimPush, finishPush, forgetSubscription, recoverPushClaims } from './store.ts';
const pub = process.env.VAPID_PUBLIC_KEY ?? '',
  priv = process.env.VAPID_PRIVATE_KEY ?? '';
if (pub && priv) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', pub, priv);
export function vapidKey() {
  return pub;
}
let draining: Promise<void> | undefined;
function retryDelay(raw: unknown) {
  if (typeof raw !== 'string') return undefined;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) ? Math.max(10_000, Math.min(ms, 3600_000)) : undefined;
}
/** The event itself is the durable outbox. At most four devices send at once. */
export function drainPushQueue(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    const jobs = snapshot()
      .events.flatMap((event) =>
        (event.delivery?.devices ?? [])
          .filter((d) => ['pending', 'retrying'].includes(d.status) && d.nextAttemptAt <= Date.now())
          .map((d) => ({ eventId: event.id, deviceId: d.deviceId })),
      )
      .reverse()
      .slice(0, 40);
    let cursor = 0;
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          const { eventId, deviceId } = jobs[cursor++]!;
          const claim = await claimPush(eventId, deviceId);
          if (!claim) continue;
          const { event, subscription } = claim;
          if (!pub || !priv) {
            await finishPush(eventId, deviceId, { status: 'failed', error: 'Push not configured' });
            continue;
          }
          try {
            await webpush.sendNotification(
              subscription,
              JSON.stringify({
                title: 'FluxDesk alert',
                body: event.message,
                eventId: event.id,
                url:
                  event.kind === 'macro' ? '/?tab=calendar' : `/?asset=${encodeURIComponent(event.assetId)}`,
              }),
              {
                TTL: Math.max(1, Math.ceil((event.delivery!.expiresAt - Date.now()) / 1000)),
                timeout: 10_000,
              },
            );
          } catch (error) {
            const failure = (error && typeof error === 'object' ? error : {}) as {
              statusCode?: number;
              headers?: Record<string, unknown>;
            };
            const code =
              Number.isInteger(failure.statusCode) && failure.statusCode! >= 100 && failure.statusCode! <= 599
                ? failure.statusCode
                : undefined;
            const expired = code === 404 || code === 410;
            const retryable =
              code === undefined || code === 429 || (typeof code === 'number' && code >= 500 && code <= 599);
            await finishPush(eventId, deviceId, {
              status: expired ? 'expired' : retryable ? 'retrying' : 'failed',
              error: expired
                ? 'Push subscription expired'
                : code
                  ? `Push service HTTP ${code}`
                  : 'Push transport timeout or network failure',
              retryAfterMs: retryDelay(failure.headers?.['retry-after']),
            });
            if (expired)
              await forgetSubscription(subscription.endpoint).catch(() =>
                console.error('Expired push subscription could not be removed'),
              );
            continue;
          }
          // If this disk commit fails, leave the claim ambiguous; never retry an accepted send automatically.
          await finishPush(eventId, deviceId, { status: 'accepted' });
        }
      }),
    );
    if (outcomes.some((result) => result.status === 'rejected'))
      throw Error('Push queue persistence unavailable');
  })().finally(() => {
    draining = undefined;
  });
  return draining;
}
export async function deliver(event: AlertEvent) {
  if (snapshot().events.some((saved) => saved.id === event.id)) await drainPushQueue();
}
export async function startPushDelivery() {
  await recoverPushClaims();
  const tick = () => void drainPushQueue().catch(() => console.error('Push queue persistence unavailable'));
  tick();
  const timer = setInterval(tick, 10_000);
  timer.unref();
  return () => clearInterval(timer);
}
