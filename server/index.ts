import {createServer, type IncomingMessage,type ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {markets,candles,assetIdentity,enrichedOpenInterest,feedHealth} from './market.ts';
import {pairStats,priceLevels} from '../src/engine/stats.ts';
import {detectSignals} from '../src/engine/signals.ts';
import {intervalsFor} from '../src/engine/intervals.ts';
import type {ScannedSignal} from '../src/types.ts';
import type {AlertKind,AlertRule,Market,PairCandidate} from '../src/types.ts';
import {load,snapshot,addAlert,deleteAlert,subscribe} from './store.ts';
import {liqEvents,liqSummary,liquidityStatus,startLiquidations} from './liquidations.ts';
import {calendar} from './calendar.ts';
import {vapidKey} from './notifications.ts';
import {runAlertScanner} from './alerts.ts';
const HOST=process.env.HOST??'127.0.0.1',PORT=Number(process.env.PORT??8787);
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&process.env.REVERSE_PROXY_OIDC!=='true')throw Error('Remote access requires REVERSE_PROXY_OIDC=true and a verified OIDC reverse proxy. Do not expose this service publicly unauthenticated.');
const json=(res:ServerResponse,data:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req:IncomingMessage){let raw='';for await(const c of req){raw+=c;if(raw.length>16_384)throw Error('Request too large');}return JSON.parse(raw||'{}') as Record<string,unknown>;}
function validatedId(id:string){assetIdentity(id);return id;}
function positiveNumber(s:unknown,max=1e15){const n=Number(s);if(!Number.isFinite(n)||n<=0||n>max)throw Error('Invalid positive threshold');return n;}
function writeSecurityHeaders(res:ServerResponse){res.setHeader('x-frame-options','DENY');res.setHeader('referrer-policy','no-referrer');res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');res.setHeader('x-content-type-options','nosniff');res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");}
function checkOrigin(req:IncomingMessage){if(!['POST','DELETE','PUT'].includes(req.method??''))return;const o=req.headers.origin;if(o){const parsed=new URL(o);const expectedHost=req.headers.host??'';if(parsed.host!==expectedHost)throw Error('Cross-origin mutation blocked');}}
async function handler(req:IncomingMessage,res:ServerResponse){writeSecurityHeaders(res);const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);const path=url.pathname;
 try{
  checkOrigin(req);
  if(path==='/api/health')return json(res,{ok:true,at:Date.now(),liquidations:liquidityStatus()});
  if(path==='/api/markets'){
   const list=await markets();const benchmarks:Record<string,Market|null>=Object.fromEntries(list.map(m=>[m.id,m]));return json(res,{assets:list,benchmarks,asOf:Math.max(0,...list.map(x=>x.asOf)),feeds:feedHealth()});
  }
  if(path==='/api/candles'){const asset=validatedId(url.searchParams.get('asset')??'');const tf=url.searchParams.get('tf')??'1h';return json(res,{asset,tf,candles:await candles(asset,tf,Math.min(Number(url.searchParams.get('limit')??140),300))});}
  if(path==='/api/asset'){
   const id=validatedId(url.searchParams.get('asset')??''),tf=url.searchParams.get('tf')??'1h';
   const major=url.searchParams.get('major')??'binance:BTCUSDT';if(major!=='USD')assetIdentity(major);
   const assets=await markets();
   const majorAsset=major==='USD'?null:assets.find(x=>x.id===major);if(major!=='USD'&&!majorAsset)throw Error('Benchmark not available in current market universe');
   const [bars,oi,referenceOI]=await Promise.all([candles(id,tf,150),enrichedOpenInterest(id),majorAsset?enrichedOpenInterest(majorAsset.id):Promise.resolve(null)]);
   const histogram=new Map<number,{notionalUsd:number;count:number}>();
   for(const e of liqEvents(id,60)){
    const binWidth=Math.max(.00001,(bars.at(-1)?.close??e.price)*.0025);const bin=Math.round(e.price/binWidth)*binWidth;
    const item=histogram.get(bin)??{notionalUsd:0,count:0};item.notionalUsd+=e.notionalUsd;item.count++;histogram.set(bin,item);
   }
   const liquidationPriceClusters=[...histogram].map(([price,v])=>({price,...v})).sort((a,b)=>b.notionalUsd-a.notionalUsd).slice(0,8);
   return json(res,{id,tf,openInterestUsd:oi,benchmarkOI:majorAsset?{id:majorAsset.id,usd:referenceOI,ratio:oi!==null&&referenceOI?oi/referenceOI:null,venueMatched:majorAsset.venue===assetIdentity(id).venue}:null,liquidationPriceClusters,levels:priceLevels(bars),signals:detectSignals(bars),candles:bars,liquidations:liqSummary(id)});
  }
  if(path==='/api/signals'){
   const asset=validatedId(url.searchParams.get('asset')??'');
   const {venue}=assetIdentity(asset);
   const timeframes=intervalsFor(venue);
   const matches:ScannedSignal[]=[];
   const failed:{timeframe:string;reason:string}[]=[];
   const inspected:{timeframe:string;bars:number}[]=[];
   // Scanning is on demand, not a runaway poll across every exchange contract.
   // Bounded parallelism and candle caching control API use.
   for(let i=0;i<timeframes.length;i+=4){
    const batch=timeframes.slice(i,i+4);
    const results=await Promise.allSettled(batch.map(async timeframe=>{
      const series=await candles(asset,timeframe,180);
      return {timeframe,signals:detectSignals(series),bars:series.length};
    }));
    results.forEach((result,j)=>{
      if(result.status==='fulfilled'){
       inspected.push({timeframe:result.value.timeframe,bars:result.value.bars});
       for(const signal of result.value.signals)matches.push({...signal,timeframe:result.value.timeframe});
      }else{
       failed.push({timeframe:batch[j]!,reason:result.reason instanceof Error?result.reason.message:'Upstream feed failed'});
      }
    });
   }
   // A candidate reflects only the most recently closed candle on its interval.
   return json(res,{asset,venue,directions:['long','short'],models:['sfp','msb','pullback','range'],checkedAt:Date.now(),inspected,failed,signals:matches});
  }
  if(path==='/api/pair'){
   const a=validatedId(url.searchParams.get('a')??''),b=validatedId(url.searchParams.get('b')??''),tf=url.searchParams.get('tf')??'1h';if(a===b)throw Error('Choose distinct assets');const [aa,bb]=await Promise.all([candles(a,tf,160),candles(b,tf,160)]);return json(res,{stats:pairStats(a,b,aa,bb,80)});
  }
  if(path==='/api/correlations'){
   const asset=validatedId(url.searchParams.get('asset')??'');const {venue}=assetIdentity(asset),tf=url.searchParams.get('tf')??'1h';const min=Math.max(.5,Math.min(.999,Number(url.searchParams.get('minimum')??.87)));
   const universe=(await markets()).filter(x=>x.venue===venue&&x.id!==asset&&x.volumeUsd24h>=1_000_000).slice(0,28);
   const reference=await candles(asset,tf,150);const candidates:PairCandidate[]=[];
   for(let i=0;i<universe.length;i+=4){const chunk=universe.slice(i,i+4);const results=await Promise.allSettled(chunk.map(async x=>pairStats(asset,x.id,reference,await candles(x.id,tf,150),80)));
    results.forEach((r,j)=>{if(r.status==='fulfilled'&&r.value&&r.value.correlation>=min){const x=chunk[j];if(x)candidates.push({id:x.id,correlation:r.value.correlation,zScore:r.value.zScore,beta:r.value.beta,points:r.value.points});}});
   }
   return json(res,{asset,threshold:min,screened:universe.length,candidates:candidates.sort((a,b)=>b.correlation-a.correlation)});
  }
  if(path==='/api/liquidations'){const asset=url.searchParams.get('asset');const minutes=Math.max(1,Math.min(60,Number(url.searchParams.get('minutes')??5)));if(asset)return json(res,liqSummary(validatedId(asset),minutes));return json(res,{events:liqEvents(undefined,minutes).slice(-100),status:liquidityStatus()});}
  if(path==='/api/calendar')return json(res,await calendar());
  if(path==='/api/alerts'&&req.method==='GET')return json(res,{alerts:snapshot().alerts,events:snapshot().events});
  if(path==='/api/alerts'&&req.method==='POST'){
   const o=await body(req),kind=o.kind as AlertKind;if(!['price','volume','liquidation'].includes(kind))throw Error('Invalid alert type');const assetId=validatedId(String(o.assetId??''));if(kind==='liquidation'&&!assetId.startsWith('binance:'))throw Error('Public market-wide Hyperliquid liquidations are not available from this connector');
   const threshold=positiveNumber(o.threshold);if(kind==='volume'&&threshold>100_000)throw Error('Volume threshold too high');const direction=o.direction==='below'?'below':'above';const a:AlertRule={id:randomUUID(),assetId,kind,threshold,direction,enabled:true,createdAt:Date.now()};await addAlert(a);return json(res,{alert:a},201);
  }
  if(path.startsWith('/api/alerts/')&&req.method==='DELETE'){const id=path.slice('/api/alerts/'.length);if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid alert ID');await deleteAlert(id);return json(res,{ok:true});}
  if(path==='/api/push/key')return json(res,{key:vapidKey()});
  if(path==='/api/push/subscribe'&&req.method==='POST'){if(!vapidKey())throw Error('VAPID is not configured');const data=await body(req);const keys=data.keys as {p256dh?:unknown;auth?:unknown}|undefined;const endpoint=String(data.endpoint??'');if(!endpoint.startsWith('https://')||endpoint.length>2048||typeof keys?.p256dh!=='string'||typeof keys.auth!=='string')throw Error('Invalid PushSubscription');await subscribe({endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth}});return json(res,{ok:true},201);}
  if(path.startsWith('/api/'))return json(res,{error:'Unknown endpoint'},404);
  // Serve compiled Vite app under the same origin in self-hosted deployment.
  const root=resolve('dist'),target=resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));if(!target.startsWith(root+sep)&&target!==root)throw Error('Invalid path');
  let file=target;try{const info=await stat(file);if(!info.isFile())file=resolve(root,'index.html');}catch{file=resolve(root,'index.html');}
  const ext=extname(file),mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
  res.setHeader('content-type',mime[ext]??'application/octet-stream');res.setHeader('cache-control',file.includes('/assets/')?'public,max-age=31536000,immutable':'no-cache');res.end(await readFile(file));
 }catch(error){const message=error instanceof Error?error.message:'Unknown error';console.error('Request failed',req.method,path,message);return json(res,{error:message},/Invalid|Unsupported|Choose|threshold|Too |limit|blocked|Cross-origin|requires|not available|large/i.test(message)?400:503);}}
await load();if(process.env.NODE_ENV!=='test'){startLiquidations();runAlertScanner();}createServer((req,res)=>void handler(req,res)).listen(PORT,HOST,()=>console.info(`FluxDesk API listening on http://${HOST}:${PORT}`));
