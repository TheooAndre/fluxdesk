// Deterministic upstream fixtures used ONLY by the spawned Node integration-test server.
// They are never imported by production code or shipped to browsers.
const marketTicker = [
  {symbol:'BTCUSDT',lastPrice:'100000',priceChangePercent:'3',quoteVolume:'500000000',openPrice:'97000',closeTime:Date.now()},
  {symbol:'ETHUSDT',lastPrice:'4000',priceChangePercent:'5',quoteVolume:'250000000',openPrice:'3800',closeTime:Date.now()},
];
const info = {symbols:[
  {symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',contractType:'PERPETUAL',status:'TRADING'},
  {symbol:'ETHUSDT',baseAsset:'ETH',quoteAsset:'USDT',contractType:'PERPETUAL',status:'TRADING'},
  {symbol:'OLDUSDT',baseAsset:'OLD',quoteAsset:'USDT',contractType:'PERPETUAL',status:'BREAK'},
]};
const hyper = [
  {universe:[{name:'HYPE'},{name:'BTC'},{name:'DEL',isDelisted:true}]},
  [
    {markPx:'50',prevDayPx:'45',dayNtlVlm:'10000000',openInterest:'60000'},
    {markPx:'100050',prevDayPx:'98000',dayNtlVlm:'30000000',openInterest:'550'},
    {markPx:'3',prevDayPx:'3',dayNtlVlm:'1000',openInterest:'100'},
  ],
];
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}
function bins(limit=201){
 const now=Date.now();return Array.from({length:limit},(_,i)=>{
  const time=now-(limit-i)*3_600_000,close=100+i*.12+Math.sin(i/9);
  // Latest bar's exchange close is in the future, so it must be excluded.
  const closeTime=i===limit-1?now+60_000:time+3_600_000-1;
  return {time,closeTime,open:close-.3,high:close+1.1,low:close-1,close};
 });
}
const original=globalThis.fetch;
globalThis.fetch=async (input,options={})=>{
 const url=String(input);
 if(url.includes('fapi.binance.com/fapi/v1/ticker/24hr'))return response(marketTicker);
 if(url.includes('fapi.binance.com/fapi/v1/exchangeInfo'))return response(info);
 if(url.includes('fapi.binance.com/fapi/v1/openInterest'))return response({openInterest:'15'});
 if(url.includes('fapi.binance.com/fapi/v1/premiumIndex'))return response({markPrice:'100'});
 if(url.includes('fapi.binance.com/fapi/v1/klines')){
  const count=Math.min(Number(new URL(url).searchParams.get('limit')||201),300);
  return response(bins(count).map(x=>[x.time,String(x.open),String(x.high),String(x.low),String(x.close),'50',x.closeTime,String(x.close*50),'0','0','0','0']));
 }
 if(url==='https://api.hyperliquid.xyz/info'){
  const payload=JSON.parse(options.body||'{}');
  if(payload.type==='metaAndAssetCtxs')return response(hyper);
  if(payload.type==='candleSnapshot')return response(bins(190).map(x=>({t:x.time,T:x.closeTime,o:String(x.open),h:String(x.high),l:String(x.low),c:String(x.close),v:'15'})));
  return response({error:'Unknown test fixture request'},400);
 }
 if(url.includes('api.tradingeconomics.com'))return response([]);
 return original(input,options);
};
