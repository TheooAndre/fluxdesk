/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly, NetworkFirst } from 'workbox-strategies';
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
// Offline shell only: an old API response must never masquerade as a fresh quote or alert state.
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly(), 'GET');
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly(), 'POST');
const pages = new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 3 });
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ event, request }) => {
    try {
      return await pages.handle({ event, request });
    } catch {
      return (await matchPrecache('/offline.html')) ?? Response.error();
    }
  },
);
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('market-api'));
});
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json() as { title: string; body: string; url: string };
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: data.url },
      }),
    );
  } catch {
    /* A malformed push must not crash the worker. */
  }
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    String((event.notification.data as { url?: string })?.url ?? '/'),
    self.location.origin,
  );
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(url.href).then(() => {}));
});
