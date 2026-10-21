/** Exchange-supported candle intervals. Keep the actual set venue-specific. */
import type {Venue} from '../types.ts';
export const BINANCE_INTERVALS=['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'] as const;
export const HYPERLIQUID_INTERVALS=['1m','3m','5m','15m','30m','1h','2h','4h','8h','12h','1d','3d','1w','1M'] as const;
export type CandleInterval=typeof BINANCE_INTERVALS[number];
export const intervalsFor=(venue:Venue):readonly CandleInterval[]=>venue==='binance'?BINANCE_INTERVALS:HYPERLIQUID_INTERVALS;
export function assertInterval(venue:Venue,value:string):asserts value is CandleInterval{
 if(!intervalsFor(venue).some(tf=>tf===value))throw new Error(`Unsupported ${venue} interval: ${value}`);
}
export const intervalDurationMs=(value:CandleInterval):number=>{
 const amount=Number.parseInt(value,10);
 if(value.endsWith('m'))return amount*60_000;
 if(value.endsWith('h'))return amount*3_600_000;
 if(value.endsWith('d'))return amount*86_400_000;
 if(value.endsWith('w'))return amount*604_800_000;
 return amount*31*86_400_000; // overfetch for calendar months; completion uses exchange close time.
};

/** Preserve a selected timeframe across venue changes only when the destination offers it. */
export function retainedIntervalForAsset(assetId:string,current:CandleInterval):CandleInterval{
 const venue:Venue=assetId.startsWith('hyperliquid:')?'hyperliquid':'binance';
 return intervalsFor(venue).includes(current)?current:'1h';
}
