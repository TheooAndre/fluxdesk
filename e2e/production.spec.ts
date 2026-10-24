import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const asset = {
    id: 'binance:ETHUSDT',
    base: 'ETH',
    symbol: 'ETHUSDT',
    venue: 'binance',
    price: 3000,
    previous24h: 2900,
    return24h: 3.44,
    volumeUsd24h: 1000000,
    oiUsd: null,
    priceBasis: 'last',
    timestampBasis: 'exchange',
    asOf: Date.now(),
  };
  const candles = Array.from({ length: 80 }, (_, i) => ({
    time: Date.now() - (80 - i) * 3600_000,
    open: 3000 + i,
    high: 3002 + i,
    low: 2999 + i,
    close: 3001 + i,
    volumeBase: 5,
    volumeUsd: 15000,
  }));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === '/api/markets'
        ? {
            assets: [asset],
            benchmarks: { [asset.id]: asset },
            feeds: [
              {
                venue: 'binance',
                status: 'live',
                lastSuccessAt: Date.now(),
                lastAttemptAt: Date.now(),
                markets: 1,
                ageMs: 0,
              },
            ],
            asOf: Date.now(),
            checkedAt: Date.now(),
          }
        : path === '/api/watchlist'
          ? { assetIds: [] }
          : path === '/api/asset'
            ? {
                id: asset.id,
                candles,
                levels: [],
                signals: [],
                liquidationPriceClusters: [],
                openInterestUsd: null,
                benchmarkOI: null,
                liquidations: {
                  observedUsd: null,
                  available: false,
                  windowCovered: false,
                  count: 0,
                  events: [],
                  coverage: 'unavailable',
                },
              }
            : path === '/api/perpetual'
              ? { assetId: asset.id, status: 'unavailable', asOf: null, fundingRate: null }
              : {};
    return route.fulfill({ json });
  });
});
test('paints real production HTML before JavaScript and preserves the heading through hydration', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/index-*.js', async (route) => {
    await blocked;
    await route.continue();
  });
  await page.goto('/?asset=binance%3AETHUSDT', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Market overview' })).toBeVisible();
  await expect(page.locator('style[data-fluxdesk-entry]')).toHaveCount(1);
  await expect(page.locator('link[rel="stylesheet"]')).toHaveCount(0);
  await page.evaluate(() => {
    Object.assign(window, { originalHeading: document.querySelector('h1') });
  });
  release();
  await expect(page.locator('.layout')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByLabel('Selected asset')).toHaveValue('binance:ETHUSDT');
  await expect(page.getByRole('img', { name: 'ETH 1h interactive price and volume chart' })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { originalHeading?: Element }).originalHeading === document.querySelector('h1'),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test('production chart switches and resizes without hydration or canvas errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?asset=binance%3AETHUSDT');
  await expect(page.getByRole('img', { name: 'ETH 1h interactive price and volume chart' })).toBeVisible();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByLabel('EMA 20 / 50').check();
  await page.getByRole('button', { name: 'Zoom in chart' }).click();
  await page.getByRole('button', { name: 'Pan chart earlier' }).click();
  await page.getByRole('button', { name: 'Expand chart', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close expanded chart' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand chart', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
