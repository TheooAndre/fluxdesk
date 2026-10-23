import { expect, test } from 'vitest';
import { tradingViewChart, tradingViewLayout } from '../src/lib/tradingview.ts';
test('saved layout validation rejects other hosts, credentials and non-layout URLs', () => {
  for (const input of [
    'javascript:alert(1)',
    'https://tradingview.com.evil.test/chart/abc/',
    'https://evil.test/chart/abc/',
    'https://user:pass@www.tradingview.com/chart/abc/',
    'http://tradingview.com/chart/abc/',
    'https://tradingview.com/chart/',
    'https://tradingview.com:8888/chart/abc/',
  ])
    expect(tradingViewLayout(input)).toBeNull();
  expect(tradingViewLayout(' https://tradingview.com/chart/Ab12/?symbol=OTHER#test ')).toBe(
    'https://www.tradingview.com/chart/Ab12/',
  );
});
test('external chart preserves venue and multiplier contracts, leaves uncertain mappings unset', () => {
  const url = new URL(tradingViewChart('binance:1000PEPEUSDT', '4h'));
  expect(url.searchParams.get('symbol')).toBe('BINANCE:1000PEPEUSDT.P');
  expect(url.searchParams.get('interval')).toBe('240');
  expect(new URL(tradingViewChart('hyperliquid:BTC', '1d')).searchParams.get('symbol')).toBe(
    'HYPERLIQUID:BTCUSDC.P',
  );
  expect(new URL(tradingViewChart('hyperliquid:xyz:TSLA', '1h')).searchParams.has('symbol')).toBe(false);
});
