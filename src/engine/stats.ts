import type { Candle, PairStats, PriceLevel } from '../types.ts';
export function mean(values:number[]):number{return values.reduce((a,b)=>a+b,0)/values.length;}
export function std(values:number[]):number{if(values.length<2)return 0;const m=mean(values);return Math.sqrt(values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1));}
export function correlation(a:number[],b:number[]):number{if(a.length!==b.length||a.length<30)return NaN;const am=mean(a),bm=mean(b);const cov=a.reduce((s,x,i)=>s+(x-am)*((b[i]??0)-bm),0);const aa=a.reduce((s,x)=>s+(x-am)**2,0);const bb=b.reduce((s,y)=>s+(y-bm)**2,0);return aa>0&&bb>0?cov/Math.sqrt(aa*bb):NaN;}
export function alignedPairs(a:Candle[],b:Candle[]):[Candle,Candle][]{const byTime=new Map(b.map(x=>[x.time,x]));return a.flatMap(x=>{const y=byTime.get(x.time);return y?[[x,y] as [Candle,Candle]]:[];});}
export function relativeReturn(asset:number,baseline:number):number{if(!Number.isFinite(asset)||!Number.isFinite(baseline)||baseline<=-100)return NaN;return ((1+asset/100)/(1+baseline/100)-1)*100;}
/** Uses aligned *completed* candle closes. Historical z values use rolling past-only hedge estimates. */
export function pairStats(aId:string,bId:string,a:Candle[],b:Candle[],window=80):PairStats|null{
 const matched=alignedPairs(a,b);if(matched.length<Math.max(40,window))return null;
 const logsA=matched.map(([x])=>Math.log(x.close)),logsB=matched.map(([,x])=>Math.log(x.close));
 if(logsA.some(x=>!Number.isFinite(x))||logsB.some(x=>!Number.isFinite(x)))return null;
 const retA=logsA.slice(1).map((x,i)=>x-(logsA[i]??x));const retB=logsB.slice(1).map((x,i)=>x-(logsB[i]??x));
 const corr=correlation(retA,retB);if(!Number.isFinite(corr))return null;
 const fit=(from:number,to:number)=>{const x=logsB.slice(from,to),y=logsA.slice(from,to),mx=mean(x),my=mean(y);const den=x.reduce((s,v)=>s+(v-mx)**2,0);const beta=den?x.reduce((s,v,i)=>s+(v-mx)*((y[i]??0)-my),0)/den:0;return {beta,intercept:my-beta*mx};};
 const start=Math.max(window,40);const series:{time:number;z:number}[]=[];
 for(let i=start;i<logsA.length;i++){
  // Fit only prior closes, never current decision candle.
  const {beta,intercept}=fit(i-window,i);
  const spread=logsA.slice(i-window,i).map((x,j)=>x-intercept-beta*(logsB[i-window+j]??0));
  const sigma=std(spread);const present=(logsA[i]??0)-intercept-beta*(logsB[i]??0);
  if(sigma>1e-10)series.push({time:matched[i]?.[0].time??0,z:(present-mean(spread))/sigma});
 }
 const {beta}=fit(logsA.length-window,logsA.length);const last=series.at(-1)?.z??NaN;
 if(!Number.isFinite(last))return null;
 const spread=logsA.map((x,i)=>x-beta*(logsB[i]??0));
 const delta=spread.slice(1).map((x,i)=>x-(spread[i]??x)),prev=spread.slice(0,-1), pm=mean(prev),dm=mean(delta);
 const slope=prev.reduce((s,x,i)=>s+(x-pm)*((delta[i]??0)-dm),0)/Math.max(1e-12,prev.reduce((s,x)=>s+(x-pm)**2,0));
 const halfLife=slope<0?Math.log(2)/-Math.log(Math.max(1e-8,1+slope)):null;
 return {a:aId,b:bId,correlation:corr,beta,zScore:last,halfLifeBars:Number.isFinite(halfLife)?halfLife:null,points:matched.length,spreadSeries:series.slice(-100),note:'Return correlation is a screening statistic, not proof of cointegration or a profitable strategy.'};
}
export function atr(candles:Candle[],n=14):number{const full=candles.slice(-(n+1));if(full.length<2)return NaN;const trs=full.slice(1).map((b,i)=>{const last=full[i]?.close??b.open;return Math.max(b.high-b.low,Math.abs(b.high-last),Math.abs(b.low-last));});return mean(trs);}
export function priceLevels(candles:Candle[]):PriceLevel[]{if(candles.length<41)return [];const lookback=candles.slice(-41,-1),last=candles.at(-1);if(!last)return [];
 const a=atr(candles);const levels:PriceLevel[]=[];
 const high=Math.max(...lookback.map(c=>c.high)),low=Math.min(...lookback.map(c=>c.low));
 levels.push({kind:'resistance',price:high,note:'Prior 40 completed bars: range high'},{kind:'support',price:low,note:'Prior 40 completed bars: range low'});
 if(Number.isFinite(a)){levels.push({kind:'resistance',price:last.close+a,note:'1 ATR above last close'},{kind:'support',price:last.close-a,note:'1 ATR below last close'});}
 // No account leverage/margin data; no asserted actual future liquidation price levels.
 return levels.filter(x=>Number.isFinite(x.price)&&x.price>0);
}
export function volumeSpikePct(candles:Candle[],window=20):number|null{if(candles.length<window+1)return null;const last=candles.at(-1)!;const previous=candles.slice(-window-1,-1).map(x=>x.volumeUsd);const baseline=mean(previous);return baseline>0?(last.volumeUsd/baseline-1)*100:null;}

/** Crossing, not merely being on the alert side of a level, triggers a price alert. */
export function crossedPriceLevel(previous:number,current:number,threshold:number,direction:'above'|'below'):boolean{
 if(![previous,current,threshold].every(Number.isFinite)||threshold<=0)return false;
 return direction==='above'?previous<threshold&&current>=threshold:previous>threshold&&current<=threshold;
}
