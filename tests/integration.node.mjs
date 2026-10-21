import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const PROJECT_ROOT=fileURLToPath(new URL('../',import.meta.url));
let child,port,dataDir;
async function unusedPort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function request(path,init){const res=await fetch(`http://127.0.0.1:${port}${path}`,init);const body=await res.json();return {res,body};}
before(async()=>{
 port=await unusedPort();dataDir=await mkdtemp(join(tmpdir(),'fluxdesk-test-'));
 child=spawn(process.execPath,['--experimental-strip-types','--import','./tests/fixtures/mock-exchanges.mjs','server/index.ts'],{
  cwd:PROJECT_ROOT,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir,NODE_ENV:'test',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},stdio:['ignore','pipe','pipe'],
 });
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString()});
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error(`API terminated during boot: ${stderr}`);
  try{const {res}=await request('/api/health');if(res.ok)return;}catch{/* Server may still be starting. */}
  await new Promise(resolve=>setTimeout(resolve,60));
 }
 throw Error(`API failed startup within 6 seconds: ${stderr}`);
});
after(async()=>{if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('close',resolve))}if(dataDir)await rm(dataDir,{recursive:true,force:true});});

test('market discovery includes two sources with explicit status, excludes delisted markets',async()=>{
 const {res,body}=await request('/api/markets');assert.equal(res.status,200);
 assert.equal(body.feeds.binance,true);assert.equal(body.feeds.hyperliquid,true);
 assert.ok(body.feeds.lastSuccessfulFetchAt>0);
 assert.deepEqual(new Set(body.assets.map(x=>x.id)),new Set(['binance:BTCUSDT','binance:ETHUSDT','hyperliquid:HYPE','hyperliquid:BTC']));
 assert.equal(body.benchmarks['binance:BTCUSDT'].id,'binance:BTCUSDT');assert.equal(body.benchmarks['hyperliquid:HYPE'].id,'hyperliquid:HYPE');
});
test('exchange candles exclude the current unclosed candle',async()=>{
 for(const asset of ['binance:BTCUSDT','hyperliquid:HYPE']){
  const {res,body}=await request(`/api/candles?asset=${asset}&tf=1h&limit=140`);
  assert.equal(res.status,200);assert.equal(body.candles.length,140);
  assert.ok(body.candles.every(c=>c.closeTime<Date.now()));
 }
});
test('one asset provides completed bars, levels, open interest and explicit partial liquidation coverage',async()=>{
 const {res,body}=await request('/api/asset?asset=binance:BTCUSDT&tf=1h&major=binance:BTCUSDT');assert.equal(res.status,200);
 assert.equal(body.candles.length,150);assert.ok(body.levels.length>=2);
 assert.equal(body.openInterestUsd,1500);assert.equal(body.benchmarkOI.ratio,1);
 assert.equal(body.liquidations.coverage,'partial_snapshots');
});
test('both long and short scanners enumerate all venue-supported intervals',async()=>{
 for(const [asset,expected] of [['binance:BTCUSDT',15],['hyperliquid:HYPE',14]]){
  const {res,body}=await request(`/api/signals?asset=${asset}`);assert.equal(res.status,200);
  assert.equal(body.inspected.length,expected,JSON.stringify(body.failed));assert.equal(body.failed.length,0);
  assert.deepEqual(body.directions,['long','short']);assert.deepEqual(body.models,['sfp','msb','pullback','range']);
 }
});
test('alert create/delete works and persisted records are accurate',async()=>{
 const {res,body}=await request('/api/alerts',{method:'POST',headers:{'content-type':'application/json','origin':`http://127.0.0.1:${port}`},body:JSON.stringify({kind:'volume',assetId:'binance:BTCUSDT',threshold:100})});
 assert.equal(res.status,201);assert.equal(body.alert.kind,'volume');
 const {body:current}=await request('/api/alerts');assert.equal(current.alerts.length,1);
 const persisted=JSON.parse(await readFile(join(dataDir,'state.json'),'utf8'));assert.equal(persisted.alerts[0].id,body.alert.id);
 const remove=await request(`/api/alerts/${body.alert.id}`,{method:'DELETE'});assert.equal(remove.res.status,200);
 assert.equal((await request('/api/alerts')).body.alerts.length,0);
});
test('malformed asset identifiers, unsupported timeframes and CSRF-like origins are rejected',async()=>{
 assert.equal((await request('/api/candles?asset=binance:BTCUSDT:extra&tf=1h')).res.status,400);
 assert.equal((await request('/api/candles?asset=hyperliquid:HYPE&tf=6h')).res.status,400);
 assert.equal((await request('/api/alerts',{method:'POST',headers:{'content-type':'application/json',origin:'https://outside.example'},body:'{}'})).res.status,400);
});
