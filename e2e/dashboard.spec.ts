import { test, expect } from '@playwright/test';
const market = (id: string, base: string, venue: 'binance' | 'hyperliquid', r: number, vol: number) => ({
  id,
  base,
  venue,
  symbol: id.split(':')[1],
  price: base === 'BTC' ? 100000 : base === 'ETH' ? 4000 : 200,
  previous24h: 1,
  return24h: r,
  volumeUsd24h: vol,
  oiUsd: venue === 'hyperliquid' ? 10_000_000 : null,
  asOf: Date.now(),
});
const btc = market('binance:BTCUSDT', 'BTC', 'binance', 3, 600_000_000);
const eth = market('binance:ETHUSDT', 'ETH', 'binance', 5, 300_000_000);
const hype = market('hyperliquid:HYPE', 'HYPE', 'hyperliquid', 2, 90_000_000);
const candles = Array.from({ length: 150 }, (_, i) => ({
  time: Date.now() - (150 - i) * 3600_000,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volumeBase: 3,
  volumeUsd: 30000,
}));
test.beforeEach(async ({ page }) => {
  await page.route('**/api/markets', (route) =>
    route.fulfill({
      json: {
        assets: [btc, eth, hype],
        benchmarks: { BTC: btc, ETH: eth, SOL: null, HYPE: hype, XAU: null },
        asOf: Date.now(),
        checkedAt: Date.now(),
        feeds: [
          {
            venue: 'binance',
            status: 'live',
            lastSuccessAt: Date.now(),
            lastAttemptAt: Date.now(),
            ageMs: 0,
            markets: 2,
          },
          {
            venue: 'hyperliquid',
            status: 'live',
            lastSuccessAt: Date.now(),
            lastAttemptAt: Date.now(),
            ageMs: 0,
            markets: 1,
          },
        ],
      },
    }),
  );
  await page.route('**/api/asset?**', (route) =>
    route.fulfill({
      json: {
        id: btc.id,
        tf: '1h',
        openInterestUsd: 100_000_000,
        benchmarkOI: { id: btc.id, usd: 100_000_000, ratio: 1, venueMatched: true },
        liquidationPriceClusters: [],
        levels: [],
        signals: [],
        candles,
        liquidations: {
          observedUsd: 0,
          count: 0,
          events: [],
          coverage: 'partial_snapshots',
          available: true,
          windowCovered: true,
        },
      },
    }),
  );
  await page.route('**/api/signals?**', (route) =>
    route.fulfill({
      json: {
        asset: btc.id,
        venue: 'binance',
        checkedAt: Date.now(),
        inspected: Array.from({ length: 15 }, (_, i) => ({ timeframe: String(i), bars: 150 })),
        failed: [],
        signals: [],
      },
    }),
  );
  await page.route('**/api/correlations?**', (route) =>
    route.fulfill({
      json: {
        asset: btc.id,
        threshold: 0.87,
        screened: 2,
        checked: 2,
        failed: [],
        checkedAt: Date.now(),
        candidates: [],
      },
    }),
  );
  await page.route('**/api/calendar', (route) =>
    route.fulfill({ json: { configured: false, events: [], message: 'Calendar API not configured' } }),
  );
  await page.route('**/api/alerts', (route) => route.fulfill({ json: { alerts: [], events: [] } }));
});
test('market table sorts and asset selection are usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Market overview')).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('Sort by').selectOption('relative');
  await expect(page.getByRole('row', { name: /ETH/ })).toBeVisible();
  await page.getByLabel('Selected asset').selectOption(eth.id);
  await expect(page.getByText('ETH', { exact: true }).first()).toBeVisible();
});
test('four entry model descriptions and macro empty state', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  const mobile = await nav.isVisible();
  await (
    mobile ? nav.getByRole('button', { name: 'Signals' }) : page.getByRole('button', { name: 'Entry models' })
  ).click();
  for (const x of [
    'Swing Failure Pattern',
    'Market Structure Break',
    'Trend Continuation',
    'Consolidation / Chop',
  ])
    await expect(page.locator('b').getByText(x, { exact: true })).toBeVisible();
  await (
    mobile ? nav.getByRole('button', { name: 'Macro' }) : page.getByRole('button', { name: 'Macro calendar' })
  ).click();
  await expect(page.getByText('Calendar API not configured')).toBeVisible();
});
test('mobile dashboard reacts to loss of network and preserves navigation', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!isMobile, 'Mobile-only offline UX');
  await page.goto('/');
  await context.setOffline(true);
  await expect(page.getByText(/Offline: showing cached views/)).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Signals' })
    .click();
  await expect(page.getByText('Four-model entry scanner')).toBeVisible();
  await context.setOffline(false);
});

test('all-timeframe entry scanner supports both sides and selective timeframe inspection', async ({
  page,
}) => {
  await page.goto('/');
  const mobile = await page.getByRole('navigation', { name: 'Mobile navigation' }).isVisible();
  await (
    mobile
      ? page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Signals' })
      : page.getByRole('button', { name: 'Entry models' })
  ).click();
  await expect(page.locator('.pill').getByText('LONG + SHORT', { exact: true })).toBeVisible();
  await expect(page.getByText(/15\/15 intervals checked/)).toBeVisible();
  await page.getByLabel('Signal detail timeframe').selectOption('1m');
  await expect(page.getByLabel('Analysis timeframe')).toHaveValue('1m');
});
