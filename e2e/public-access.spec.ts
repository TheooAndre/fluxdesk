import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_FLUXDESK_PUBLIC_MODE !== 'true', 'Run with VITE_FLUXDESK_PUBLIC_MODE=true');

test('public markets/calendar render without fetching private data, then session enables alerts', async ({ page }) => {
  let authenticated = false;
  const privateReads: string[] = [];
  const asset = { id: 'binance:BTCUSDT', base: 'BTC', symbol: 'BTCUSDT', venue: 'binance',
    price: 100000, priceBasis: 'last', timestampBasis: 'exchange', previous24h: 99000,
    return24h: 1, volumeUsd24h: 1000000, oiUsd: null, asOf: Date.now() };
  await page.route('**/api/**', route => {
    if (/\/api\/(journal|alerts|watchlist|push)/.test(new URL(route.request().url()).pathname))
      privateReads.push(route.request().url());
    return route.fulfill({ status: 404, json: { error: 'Mock route absent' } });
  });
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated, accountId: authenticated ? 'discord:111' : null,
    provider: authenticated ? 'discord' : null, name: authenticated ? 'Owner' : null,
    owner: authenticated, providers: { discord: true, x: true },
  } }));
  await page.route('**/api/health', route => {
    const at = Date.now();
    return route.fulfill({ json: { ok: true, at, liquidations: { connected: true },
      markets: { running: true, intervalMs: 10000, completedCycles: 5, lastStartedAt: at - 2000,
        lastCompletedAt: at - 1000, feeds: ['binance', 'hyperliquid'].map(venue =>
          ({ venue, status: 'live', lastSuccessAt: at - 1000 })) } } });
  });
  await page.route('**/api/markets', route => route.fulfill({ json: { assets: [asset],
    benchmarks: { [asset.id]: asset }, asOf: Date.now(), checkedAt: Date.now(),
    feeds: ['binance', 'hyperliquid'].map(venue =>
      ({ venue, status: 'live', lastSuccessAt: Date.now(), lastAttemptAt: Date.now(), ageMs: 0, markets: 1 })) } }));
  await page.route('**/api/calendar', route => route.fulfill({ json: { configured: true, events: [], source: 'xoomar' } }));
  await page.route('**/api/alerts', route => route.fulfill({ json: { alerts: [], events: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Market overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Macro calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Macro calendar' })).toBeVisible();
  await page.getByRole('button', { name: 'Trade journal' }).click();
  await expect(page.getByRole('link', { name: 'Continue with Discord' })).toHaveAttribute('href', '/api/auth/discord');
  await expect(page.getByRole('link', { name: 'Continue with X' })).toHaveAttribute('href', '/api/auth/x');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  expect(privateReads).toEqual([]);
  authenticated = true;
  await page.reload();
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.getByText('No alert rules. Choose a rule on the left.')).toBeVisible();
  expect(privateReads.some(url => url.endsWith('/api/alerts'))).toBe(true);
});
