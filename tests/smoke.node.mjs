import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relativeReturn,volumeSpikePct,priceLevels,correlation,pairStats,crossedPriceLevel} from '../src/engine/stats.ts';
import {detectSignals} from '../src/engine/signals.ts';
import {intervalsFor,assertInterval,retainedIntervalForAsset} from '../src/engine/intervals.ts';
const BAR=3_600_000;
const bar=(i,close,high=close+1,low=close-1,volume=100)=>({time:i*BAR,open:close-.3,high,low,close,volumeBase:1,volumeUsd:volume});
test('relative performance is multiplicative',()=>{assert.ok(Math.abs(relativeReturn(10,5)-4.7619047619)<1e-8)});
test('volume spike excludes latest bar from baseline',()=>{const base=Array.from({length:20},(_,i)=>bar(i,100));assert.equal(volumeSpikePct(base),null);assert.equal(volumeSpikePct([...base,bar(20,100,101,99,300)]),200)});
test('resistance level excludes latest bar high',()=>{const bars=Array.from({length:50},(_,i)=>bar(i,100,102,98));bars[49]=bar(49,110,130,80);assert.equal(priceLevels(bars).find(x=>x.note.includes('range high'))?.price,102)});
test('return correlation cannot be formed with two bars or zero variance',()=>{assert.equal(Number.isNaN(correlation([1,2],[1,2])),true);assert.equal(Number.isNaN(correlation(Array(35).fill(1),Array(35).fill(2))),true)});
test('pair statistics never align mismatched dates as if simultaneous',()=>{const a=Array.from({length:100},(_,i)=>bar(i,100+i));const b=Array.from({length:100},(_,i)=>bar(i+1000,100+i));assert.equal(pairStats('a','b',a,b,50),null)});
test('swing failure candidate has structural stop above sweep candle',()=>{const a=Array.from({length:65},(_,i)=>bar(i,100+.05*Math.sin(i)));a.push({...bar(65,99,104,98),open:101});const signal=detectSignals(a).find(s=>s.model==='sfp'&&s.direction==='short');assert.ok(signal);assert.ok(signal.stop>104);assert.ok(signal.target<signal.trigger);assert.equal(signal.status,'candidate')});

test('price alerts trigger on crossing only',()=>{
 assert.equal(crossedPriceLevel(99,101,100,'above'),true);
 assert.equal(crossedPriceLevel(101,102,100,'above'),false);
 assert.equal(crossedPriceLevel(101,99,100,'below'),true);
});

test('scanners enumerate every native interval and reject venue-unsupported ones',()=>{
 assert.equal(intervalsFor('binance').length,15);
 assert.equal(intervalsFor('hyperliquid').length,14);
 assert.equal(intervalsFor('binance').includes('6h'),true);
 assert.equal(intervalsFor('hyperliquid').includes('6h'),false);
 assert.doesNotThrow(()=>assertInterval('binance','1M'));
 assert.throws(()=>assertInterval('hyperliquid','6h'));
});

test('switching Binance to Hyperliquid resets unsupported 6h interval but retains shared intervals',()=>{
 assert.equal(retainedIntervalForAsset('hyperliquid:HYPE','6h'),'1h');
 assert.equal(retainedIntervalForAsset('hyperliquid:HYPE','15m'),'15m');
 assert.equal(retainedIntervalForAsset('binance:BTCUSDT','6h'),'6h');
});
test('full forty prior bars are required for 40-bar price levels',()=>{
 assert.equal(priceLevels(Array.from({length:40},(_,i)=>bar(i,100))).length,0);
 const levels=priceLevels(Array.from({length:41},(_,i)=>bar(i,100)));
 assert.ok(levels.some(x=>x.note.includes('Prior 40')));
});
