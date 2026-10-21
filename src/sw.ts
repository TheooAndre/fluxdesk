/// <reference lib="webworker" />
import {clientsClaim} from 'workbox-core';
import {precacheAndRoute,cleanupOutdatedCaches,matchPrecache} from 'workbox-precaching';
import {registerRoute} from 'workbox-routing';
import {StaleWhileRevalidate,NetworkFirst,CacheFirst,NetworkOnly} from 'workbox-strategies';
import {CacheableResponsePlugin} from 'workbox-cacheable-response';
import {ExpirationPlugin} from 'workbox-expiration';
import {BackgroundSyncPlugin} from 'workbox-background-sync';
declare let self:ServiceWorkerGlobalScope & {__WB_MANIFEST: Array<{url:string;revision?:string|null}>};
precacheAndRoute(self.__WB_MANIFEST);cleanupOutdatedCaches();clientsClaim();
// Waiting SW is activated only on explicit user confirmation via SKIP_WAITING.
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ event, request }) => {
    try {
      return await new NetworkFirst({
        cacheName: 'pages',
        networkTimeoutSeconds: 3,
      }).handle({ event, request });
    } catch {
      return (await matchPrecache('/offline.html')) ?? Response.error();
    }
  },
);
registerRoute(({url})=>url.pathname.startsWith('/api/')&&url.pathname!=='/api/push/subscribe',new NetworkFirst({cacheName:'market-api',networkTimeoutSeconds:4,plugins:[new ExpirationPlugin({maxEntries:80,maxAgeSeconds:15*60})]}),'GET');
registerRoute(({request})=>['style','font'].includes(request.destination),new StaleWhileRevalidate({cacheName:'styles-fonts',plugins:[new CacheableResponsePlugin({statuses:[0,200]}),new ExpirationPlugin({maxEntries:60,maxAgeSeconds:30*86400})]}));
registerRoute(({url})=>url.pathname.startsWith('/assets/'),new CacheFirst({cacheName:'immutable-assets',plugins:[new ExpirationPlugin({maxEntries:90,maxAgeSeconds:365*86400})]}));
registerRoute(({url,request})=>url.pathname==='/api/alerts'&&request.method==='POST',new NetworkOnly({plugins:[new BackgroundSyncPlugin('alert-create-queue',{maxRetentionTime:24*60})]}),'POST');
self.addEventListener('push',event=>{if(!event.data)return;try{const data=event.data.json() as {title:string;body:string;url:string};event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',data:{url:data.url}}));}catch(error){console.warn('Push notification failed:',error);}});
self.addEventListener('notificationclick',event=>{event.notification.close();const path=String((event.notification.data as {url?:string})?.url??'/');const url=new URL(path,self.location.origin);if(url.origin!==self.location.origin)return;event.waitUntil(self.clients.openWindow(url.href).then(()=>{}));});
