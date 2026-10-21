import type {AlertEvent} from '../src/types.ts';
import {snapshot,forgetSubscription} from './store.ts';
const pub=process.env.VAPID_PUBLIC_KEY??'',priv=process.env.VAPID_PRIVATE_KEY??'';
// Web Push is optional for local research. Defer loading the provider until configured;
// the read-only API and all dependency-free integration tests work without VAPID.
let sender:Promise<typeof import('web-push')>|undefined;
function pushClient(){
 if(!sender) sender=import('web-push').then(({default:client})=>{
  client.setVapidDetails(process.env.VAPID_SUBJECT??'mailto:admin@example.com',pub,priv);
  return client;
 });
 return sender;
}
export function vapidKey(){return pub&&priv?pub:'';}
export async function deliver(event:AlertEvent){if(!pub||!priv)return;
 const client=await pushClient();
 const payload=JSON.stringify({title:'FluxDesk alert',body:event.message,url:`/?asset=${encodeURIComponent(event.assetId)}`});
 for(const s of snapshot().subscriptions){
  try{await client.sendNotification(s,payload,{TTL:300});}
  catch(e){const code=(e as {statusCode?:number}).statusCode;if(code===404||code===410)await forgetSubscription(s.endpoint);}
 }
}
