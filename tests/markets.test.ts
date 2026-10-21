import {describe,it,expect} from 'vitest';
import {assetIdentity} from '../server/market.ts';
describe('input validation',()=>{it('accepts Binance and Hyperliquid contract IDs',()=>{expect(assetIdentity('binance:BTCUSDT')).toEqual({venue:'binance',symbol:'BTCUSDT'});expect(assetIdentity('hyperliquid:BTC')).toEqual({venue:'hyperliquid',symbol:'BTC'})});it('rejects arbitrary URLs and delimiters',()=>{expect(()=>assetIdentity('evil:https://test')).toThrow();expect(()=>assetIdentity('../BTC')).toThrow()});});
