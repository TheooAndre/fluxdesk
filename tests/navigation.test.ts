import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
});
it('switches venues without a runtime crash and resets only unsupported intervals', async () => {
  vi.stubGlobal('window', { location: { search: '' } });
  const replaceState = vi.fn();
  vi.stubGlobal('history', { replaceState });
  const { useUi } = await import('../src/lib/store.ts');
  useUi.getState().setTf('6h');
  useUi.getState().setAsset('hyperliquid:BTC');
  expect(useUi.getState().tf).toBe('1h');
  expect(useUi.getState().assetId).toBe('hyperliquid:BTC');
  useUi.getState().setTf('4h');
  useUi.getState().setAsset('binance:ETHUSDT');
  expect(useUi.getState().tf).toBe('4h');
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '/?asset=binance%3AETHUSDT');
});

it('restores a valid deep link after initial UI creation and ignores malformed links', async () => {
  const { useUi, restoreAssetFromLocation } = await import('../src/lib/store.ts');
  vi.stubGlobal('window', { location: { search: '?asset=hyperliquid%3AETH' } });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  restoreAssetFromLocation();
  expect(useUi.getState().assetId).toBe('hyperliquid:ETH');
  vi.stubGlobal('window', { location: { search: '?asset=binance%3ABTCUSDT%3Aextra' } });
  restoreAssetFromLocation();
  expect(useUi.getState().assetId).toBe('hyperliquid:ETH');
});

it('retains the investment tab deep link when restoring a different selected crypto asset', async () => {
  const { useUi, restoreAssetFromLocation } = await import('../src/lib/store.ts');
  const location = new URL('https://example.test/?asset=binance%3ASOLUSDT&tab=investments');
  vi.stubGlobal('window', { location });
  const replaceState = vi.fn();
  vi.stubGlobal('history', { replaceState });
  restoreAssetFromLocation();
  expect(useUi.getState().tab).toBe('investments');
  expect(useUi.getState().assetId).toBe('binance:SOLUSDT');
  expect(replaceState.mock.calls.at(-1)?.[2]).toContain('tab=investments');
});
