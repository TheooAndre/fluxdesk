import webpush from 'web-push';
import type { AlertEvent } from '../src/types.ts';
import { snapshot, forgetSubscription } from './store.ts';
const pub = process.env.VAPID_PUBLIC_KEY ?? '',
  priv = process.env.VAPID_PRIVATE_KEY ?? '';
if (pub && priv) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', pub, priv);
export function vapidKey() {
  return pub;
}
export async function deliver(event: AlertEvent) {
  if (!pub || !priv) return;
  const payload = JSON.stringify({
    title: 'FluxDesk alert',
    body: event.message,
    url: `/?asset=${encodeURIComponent(event.assetId)}`,
  });
  const subscriptions = snapshot().subscriptions;
  let index = 0;
  // Bound per-device transport time and concurrency; one stalled device must not block the others.
  await Promise.all(
    Array.from({ length: Math.min(4, subscriptions.length) }, async () => {
      while (index < subscriptions.length) {
        const sub = subscriptions[index++]!;
        try {
          await webpush.sendNotification(sub, payload, { TTL: 300, timeout: 10_000 });
        } catch (error) {
          const code = (error as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            try {
              await forgetSubscription(sub.endpoint);
            } catch {
              console.error('Expired push subscription could not be removed');
            }
          }
        }
      }
    }),
  );
}
