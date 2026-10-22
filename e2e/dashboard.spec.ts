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
const ethHyper = market('hyperliquid:ETH', 'ETH', 'hyperliquid', 4, 250_000_000);
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
        assets: [btc, eth, ethHyper, hype],
        benchmarks: { [btc.id]: btc, [eth.id]: eth, [ethHyper.id]: ethHyper, [hype.id]: hype },
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
            markets: 2,
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
  await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Inspect ETH on binance' }) })).toBeVisible();
  await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Inspect ETH on hyperliquid' }) })).toBeVisible();
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
  // WebKit's context-level network emulation can leave navigator.onLine unchanged.
  // Model the browser's observable offline signal while the network is blocked.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByText(/Offline: showing cached views/)).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Signals' })
    .click();
  await expect(page.getByText('Four-model entry scanner')).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
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

test('benchmark search exposes distinct exchange markets and supports pointer selection', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search comparison benchmark' });
  await search.click();
  await search.fill('ETH');
  const options = page.getByRole('listbox', { name: 'Available comparison benchmarks' });
  await expect(options).toBeVisible();
  await expect(options.getByRole('option', { name: 'ETH · binance' })).toBeVisible();
  await expect(options.getByRole('option', { name: 'ETH · hyperliquid' })).toBeVisible();
  await options.getByRole('option', { name: 'ETH · binance' }).click();
  await expect(search).toHaveValue('ETH · binance');
  await search.click();
  await search.fill('ETH');
  await options.getByRole('option', { name: 'ETH · hyperliquid' }).click();
  await expect(search).toHaveValue('ETH · hyperliquid');

  await search.click();
  await search.fill('HYPE');
  await expect(options.getByRole('option', { name: 'HYPE · hyperliquid' })).toBeVisible();
  await options.getByRole('option', { name: 'HYPE · hyperliquid' }).click();
  await expect(search).toHaveValue('HYPE · hyperliquid');

  await search.click();
  await search.fill('USD');
  await options.getByRole('option', { name: 'USD / USDT · cash baseline' }).click();
  await expect(search).toHaveValue('USD / USDT · cash baseline');
});

test('Strategy Lab uses a saved dataset and renders a clearly labelled research-only report', async ({ page }) => {
  const dataset = {
    id: 'a'.repeat(64),
    assetId: 'binance:BTCUSDT',
    venue: 'binance',
    interval: '1h',
    capturedAt: Date.now(),
    firstOpenTime: Date.now() - 1000 * 3600_000,
    lastCloseTime: Date.now() - 1,
    bars: 1000,
  };
  let stored: typeof dataset[] = [];
  await page.route('**/api/research/datasets', (route) => {
    if (route.request().method() === 'POST') {
      stored = [dataset];
      return route.fulfill({ status: 201, json: { dataset } });
    }
    return route.fulfill({ json: { datasets: stored, rejected: 0 } });
  });
  await page.route('**/api/research/backtests', (route) => {
    const body = route.request().postDataJSON() as {
      datasetId: string;
      config: { model: string; initialEquity: number };
    };
    expect(body.datasetId).toBe(dataset.id);
    expect(body.config.model).toBe('sfp');
    return route.fulfill({
      json: {
        schemaVersion: 1,
        engineVersion: 'single-position-next-bar-v1',
        dataset,
        result: {
          hypothesis: 'Fixed historical research hypothesis. No confirmed edge.',
          config: body.config,
          bars: 1000,
          splitIndex: 750,
          trades: [
            {
              signalTime: 1000, entryTime: 2000, exitTime: 3000,
              direction: 'long', entry: 100, exit: 105, stop: 95, target: 110,
              size: 1, grossPnl: 5, fees: 1, netPnl: 4, rMultiple: 0.04,
              exitReason: 'end_of_data', sample: 'development',
            },
          ],
          summary: { count: 1, netPnl: 4, expectancyR: 0.04, maxDrawdownPct: 0, winRate: 1 },
          development: { count: 1, netPnl: 4, expectancyR: 0.04 },
          holdout: { count: 0, netPnl: 0, expectancyR: null },
          warnings: ['Holdout contains fewer than 30 closed trades; evidence is insufficient.'],
        },
      },
    });
  });
  await page.goto('/');
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  const mobile = await mobileNavigation.isVisible();
  await (
    mobile
      ? mobileNavigation.getByRole('button', { name: 'Lab' })
      : page.getByRole('button', { name: 'Strategy Lab' })
  ).click();
  await expect(page.getByRole('heading', { name: 'Strategy Lab · v0.3' })).toBeVisible();
  await expect(page.getByText('No datasets stored. Fetch historical candles to begin.')).toBeVisible();
  await page.getByRole('button', { name: /Fetch & archive history/ }).click();
  await expect(page.getByRole('combobox', { name: 'Historical dataset', exact: true })).toHaveValue(dataset.id);
  await page.getByRole('button', { name: /Run research backtest/ }).click();
  await expect(page.getByRole('heading', { name: 'Backtest results' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Backtest trade log' })).toBeVisible();
  await expect(page.getByText(/Holdout contains fewer than 30/)).toBeVisible();
  await expect(page.getByText(/RESEARCH REPORT/)).toBeVisible();
});
