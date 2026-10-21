import {describe,it,expect} from 'vitest';
import {assetIdentity} from '../server/market.ts';
describe('benchmark identifiers',()=>{
 it('supports venue-specific assets',()=>{expect(assetIdentity('binance:SOLUSDT').venue).toBe('binance');expect(assetIdentity('hyperliquid:HYPE').symbol).toBe('HYPE')});
 it('rejects malformed identifiers',()=>{expect(()=>assetIdentity('invalid')).toThrow();expect(()=>assetIdentity('binance:../../etc')).toThrow()});
});
