import type {EconomicEvent} from '../src/types.ts';
import {getJson} from './market.ts';
let cache:{at:number;value:EconomicEvent[]}|null=null;
export async function calendar():Promise<{configured:boolean;events:EconomicEvent[];message?:string}>{const key=process.env.TRADING_ECONOMICS_API_KEY;if(!key)return {configured:false,events:[],message:'Set TRADING_ECONOMICS_API_KEY to enable verified high-impact releases.'};
 if(cache&&Date.now()-cache.at<10*60_000)return {configured:true,events:cache.value};
 type TE={CalendarId:string|number;Date:string;Country:string;Event:string;Importance:number;Forecast?:string;Previous?:string;Actual?:string};
 try{const start=new Date().toISOString().slice(0,10),end=new Date(Date.now()+7*86400_000).toISOString().slice(0,10);const json=await getJson<TE[]>(`https://api.tradingeconomics.com/calendar/country/United%20States/${start}/${end}?c=${encodeURIComponent(key)}&importance=3`);
  const events=json.filter(x=>Number(x.Importance)===3).map(x=>({id:String(x.CalendarId),time:/[zZ]|[+-]\d\d:\d\d$/.test(x.Date)?x.Date:x.Date+'Z',country:x.Country,title:x.Event,importance:3 as const,forecast:String(x.Forecast??''),previous:String(x.Previous??''),actual:String(x.Actual??'')})).sort((a,b)=>a.time.localeCompare(b.time));cache={at:Date.now(),value:events};return {configured:true,events};
 }catch(e){return {configured:true,events:cache?.value??[],message:`Calendar provider error: ${(e as Error).message}`};}
}
