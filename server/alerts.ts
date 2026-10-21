import {candles,freshMarkets} from './market.ts';
import {volumeSpikePct,crossedPriceLevel} from '../src/engine/stats.ts';
import {snapshot,triggered} from './store.ts';
import {deliver} from './notifications.ts';
let running=false;
// Polling only fires on crossings/new closed bars rather than repeatedly alerting on a static price.
const lastPrice=new Map<string,number>();
const seenVolumeBar=new Map<string,number>();
export async function scanAlerts(){if(running)return;running=true;try{
 const rules=snapshot().alerts.filter(x=>x.enabled&&x.kind!=='liquidation');if(!rules.length)return;
 const list=await freshMarkets();
 for(const rule of rules){try{
  let message='';const asset=list.find(x=>x.id===rule.assetId);if(!asset)continue;
  if(rule.kind==='price'){const old=lastPrice.get(rule.id);lastPrice.set(rule.id,asset.price);if(old!==undefined&&crossedPriceLevel(old,asset.price,rule.threshold,rule.direction??'above'))message=`${asset.id} crossed ${rule.direction} ${rule.threshold}, current ${asset.price}`;}
  if(rule.kind==='volume'){const series=await candles(asset.id,'5m',25);const spike=volumeSpikePct(series);const barTime=series.at(-1)?.time;if(barTime!==undefined&&seenVolumeBar.get(rule.id)!==barTime){seenVolumeBar.set(rule.id,barTime);if(spike!==null&&spike>=rule.threshold)message=`${asset.id}: 5m notional volume +${spike.toFixed(1)}% above prior 20-bar average`;}}
  if(message){const event=await triggered(rule,message);if(event)await deliver(event);}
 }catch(error){console.error('Alert evaluation failure',rule.id,error);}}
 }catch(error){console.error('Scan failure',error);}finally{running=false;}}
export function runAlertScanner(){void scanAlerts();setInterval(()=>void scanAlerts(),60_000).unref();}
