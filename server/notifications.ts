import webpush from 'web-push';
import type {AlertEvent} from '../src/types.ts';
import {snapshot,forgetSubscription} from './store.ts';
const pub=process.env.VAPID_PUBLIC_KEY??'',priv=process.env.VAPID_PRIVATE_KEY??'';
if(pub&&priv)webpush.setVapidDetails(process.env.VAPID_SUBJECT??'mailto:admin@example.com',pub,priv);
export function vapidKey(){return pub;}
export async function deliver(event:AlertEvent){if(!pub||!priv)return;const payload=JSON.stringify({title:'FluxDesk alert',body:event.message,url:`/?asset=${encodeURIComponent(event.assetId)}`});for(const s of snapshot().subscriptions){try{await webpush.sendNotification(s,payload,{TTL:300});}catch(e){const code=(e as {statusCode?:number}).statusCode;if(code===404||code===410)await forgetSubscription(s.endpoint);}}}
