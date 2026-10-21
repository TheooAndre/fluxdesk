import type {LiquidationEvent} from '../src/types.ts';
import {randomUUID} from 'node:crypto';
import {snapshot,triggered} from './store.ts';
import {deliver} from './notifications.ts';
let socket:WebSocket|null=null;
let reconnect:NodeJS.Timeout|null=null;
let online=false;const events:LiquidationEvent[]=[];
export function liquidityStatus(){return {source:'Binance forced-order snapshots (not exhaustive exchange liquidations)',connected:online,events:events.length};}
export function liqEvents(assetId?:string,minutes=5){const now=Date.now(),ms=Math.min(Math.max(minutes,1),60)*60_000;return events.filter(x=>x.time>=now-ms&&(!assetId||x.assetId===assetId));}
export function liqSummary(assetId:string,minutes=5){const rows=liqEvents(assetId,minutes);return {assetId,minutes,observedUsd:rows.reduce((s,x)=>s+x.notionalUsd,0),count:rows.length,side:{longs:rows.filter(x=>x.side==='longs').reduce((s,x)=>s+x.notionalUsd,0),shorts:rows.filter(x=>x.side==='shorts').reduce((s,x)=>s+x.notionalUsd,0)},coverage:'partial_snapshots',events:rows.slice(-100)};}
export function startLiquidations(){
 function connect(){try{
  socket=new WebSocket('wss://fstream.binance.com/market/ws/!forceOrder@arr');
  socket.addEventListener('open',()=>{online=true;});
  socket.addEventListener('message',event=>{try{
   const payload=JSON.parse(String(event.data)) as {e?:string;E?:number;o?:{s:string;S:string;ap:string;p:string;z:string;l:string;q:string;T:number}};
   if(payload.e!=='forceOrder'||!payload.o)return;const p=payload.o,price=Number(p.ap)||Number(p.p),qty=Number(p.z)||Number(p.l);if(!price||!qty||!Number.isFinite(price*qty)||!/^[A-Z0-9]{2,30}$/.test(p.s))return;
   const record:LiquidationEvent={id:randomUUID(),assetId:`binance:${p.s}`,time:payload.E??p.T??Date.now(),price,notionalUsd:price*qty,side:p.S==='SELL'?'longs':'shorts',source:'binance_snapshot'};
   events.push(record);const cut=Date.now()-3600_000;while(events.length&&((events[0]?.time??0)<cut||events.length>20_000))events.shift();
   // Threshold interpreted as observed notional over rolling 5 min; not total venue activity.
   for(const rule of snapshot().alerts.filter(x=>x.enabled&&x.kind==='liquidation'&&x.assetId===record.assetId)){
    const amount=liqSummary(rule.assetId).observedUsd;if(amount>=rule.threshold){void triggered(rule,`${rule.assetId}: ≥ $${amount.toLocaleString('en-US',{maximumFractionDigits:0})} observed liquidation snapshots in 5m`).then(e=>{if(e)void deliver(e)});}
   }
  }catch(error){console.warn('Invalid liquidation message:',error);}});
  const disconnected=()=>{online=false;socket=null;if(!reconnect)reconnect=setTimeout(()=>{reconnect=null;connect();},5000);};socket.addEventListener('error',disconnected);socket.addEventListener('close',disconnected);
 }catch{if(!reconnect)reconnect=setTimeout(()=>{reconnect=null;connect();},10000);}}
 connect();
}
