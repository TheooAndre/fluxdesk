import type { Candle,Market,Venue } from '../src/types.ts';
import {assertInterval,intervalDurationMs} from '../src/engine/intervals.ts';
const BINANCE='https://fapi.binance.com',HL='https://api.hyperliquid.xyz/info';
export const TTL={markets:45_000,history:45_000,info:24*3600_000};
const cache=new Map<string,{expires:number,value:unknown}>();
let lastMarketFetch=0;
let feedStatus:{binance:boolean;hyperliquid:boolean}={binance:false,hyperliquid:false};
/** A partial market universe must never be mistaken for complete two-venue coverage. */
export function feedHealth(){return {...feedStatus,lastSuccessfulFetchAt:lastMarketFetch};}
async function withCache<T>(key:string,ttl:number,work:()=>Promise<T>):Promise<T>{const hit=cache.get(key);if(hit&&hit.expires>Date.now())return hit.value as T;try{const v=await work();cache.set(key,{value:v,expires:Date.now()+ttl});return v;}catch(error){if(hit&&Date.now()-hit.expires<15*60_000)return hit.value as T;throw error;}}
export async function getJson<T>(url:string,options:RequestInit={}):Promise<T>{const controller=new AbortController();const id=setTimeout(()=>controller.abort(),9_000);try{const response=await fetch(url,{...options,signal:controller.signal,headers:{'accept':'application/json',...(options.headers??{})}});if(!response.ok)throw Error(`${new URL(url).hostname} HTTP ${response.status}`);return await response.json() as T;}finally{clearTimeout(id);}}
function hyper<T>(body:object){return getJson<T>(HL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
type BinanceTicker={symbol:string;lastPrice:string;priceChangePercent:string;quoteVolume:string;openPrice:string;closeTime:number};
type BinanceInfo={symbols:{symbol:string;baseAsset:string;quoteAsset:string;contractType:string;status:string}[]};
type HyperInfo=[{universe:{name:string;isDelisted?:boolean}[]},Array<{markPx:string;midPx?:string;prevDayPx:string;dayNtlVlm:string;openInterest:string}>];
const num=(s:unknown):number=>{const n=Number(s);return Number.isFinite(n)?n:0;};
export async function markets():Promise<Market[]>{return withCache('markets',TTL.markets,async()=>{
 const [b,h]=await Promise.allSettled([Promise.all([getJson<BinanceTicker[]>(`${BINANCE}/fapi/v1/ticker/24hr`),withCache('exchangeinfo',TTL.info,()=>getJson<BinanceInfo>(`${BINANCE}/fapi/v1/exchangeInfo`))]),hyper<HyperInfo>({type:'metaAndAssetCtxs'})]);
 feedStatus={binance:b.status==='fulfilled',hyperliquid:h.status==='fulfilled'};
 const out:Market[]=[];
 if(b.status==='fulfilled'){
  const [ticker,info]=b.value;const valid=new Map(info.symbols.filter(x=>x.contractType==='PERPETUAL'&&x.status==='TRADING'&&x.quoteAsset==='USDT').map(x=>[x.symbol,x.baseAsset]));
  for(const t of ticker){const base=valid.get(t.symbol);if(!base)continue;const price=num(t.lastPrice);if(price<=0)continue;
   const return24h=num(t.priceChangePercent);out.push({id:`binance:${t.symbol}`,venue:'binance',symbol:t.symbol,base,price,return24h,previous24h:num(t.openPrice)||price/(1+return24h/100),volumeUsd24h:num(t.quoteVolume),oiUsd:null,asOf:t.closeTime||Date.now()});
  }
 }
 if(h.status==='fulfilled'){
  const [meta,ctxs]=h.value;
  meta.universe.forEach((asset,i)=>{const c=ctxs[i];if(!c||asset.isDelisted)return;const price=num(c.markPx)||num(c.midPx);if(price<=0)return;const prev=num(c.prevDayPx),volume=num(c.dayNtlVlm);
   out.push({id:`hyperliquid:${asset.name}`,venue:'hyperliquid',symbol:asset.name,base:asset.name,price,previous24h:prev||price,return24h:prev?(price/prev-1)*100:0,volumeUsd24h:volume,oiUsd:num(c.openInterest)*price,asOf:Date.now()});
  });
 }
 if(out.length===0)throw new Error(`Both market feeds failed: Binance ${b.status}, Hyperliquid ${h.status}`);
 lastMarketFetch=Date.now();
 return out.sort((a,b)=>b.volumeUsd24h-a.volumeUsd24h);
 });}
export function assetIdentity(id:string):{venue:Venue;symbol:string}{const match=/^(binance|hyperliquid):([A-Za-z0-9_]{1,32})$/.exec(id);if(!match)throw Error('Invalid asset identifier');return {venue:match[1] as Venue,symbol:match[2]!};}
export async function candles(assetId:string,interval:string,limit=140):Promise<Candle[]>{const {venue,symbol}=assetIdentity(assetId);assertInterval(venue,interval);if(!Number.isSafeInteger(limit)||limit<20||limit>300)throw Error('Limit must be 20–300');
 return withCache(`candles:${assetId}:${interval}:${limit}`,TTL.history,async()=>{
  let out:Candle[]=[];
  if(venue==='binance'){
   type Kline=[number,string,string,string,string,string,number,string,string,string,string,string];
   const raw=await getJson<Kline[]>(`${BINANCE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit+1}`);
   out=raw.map(k=>({time:k[0],open:num(k[1]),high:num(k[2]),low:num(k[3]),close:num(k[4]),volumeBase:num(k[5]),volumeUsd:num(k[7]),closeTime:k[6]}));
  }else{

   type HLCandle={t:number;T:number;o:string;h:string;l:string;c:string;v:string};
   const raw=await hyper<HLCandle[]>({type:'candleSnapshot',req:{coin:symbol,interval,startTime:Date.now()-(limit+4)*intervalDurationMs(interval),endTime:Date.now()}});
   out=raw.map(x=>{const close=num(x.c),open=num(x.o);return {time:x.t,open,high:num(x.h),low:num(x.l),close,volumeBase:num(x.v),volumeUsd:num(x.v)*(open+close)/2,closeTime:x.T};});
  }
  // Exclude the incomplete active bar; a live candle cannot be used for confirmed entry signals.
  return out.filter(x=>(x.closeTime??x.time+intervalDurationMs(interval)-1)<Date.now()&&x.close>0).slice(-limit);
 });}
export async function enrichedOpenInterest(assetId:string):Promise<number|null>{const {venue,symbol}=assetIdentity(assetId);if(venue==='hyperliquid'){return (await markets()).find(x=>x.id===assetId)?.oiUsd??null;}
 try{const [oi,ticker]=await Promise.all([getJson<{openInterest:string}>(`${BINANCE}/fapi/v1/openInterest?symbol=${symbol}`),getJson<{markPrice:string}>(`${BINANCE}/fapi/v1/premiumIndex?symbol=${symbol}`)]);return num(oi.openInterest)*num(ticker.markPrice);}catch{return null;}}
