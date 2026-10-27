import { test, expect, type Page } from '@playwright/test';
import { newTrade } from '../src/journal/model.ts';
import statarbDemo from '../src/research/statarb-demo.json' with { type: 'json' };
const market = (id: string, base: string, venue: 'binance' | 'hyperliquid', r: number, vol: number) => ({
  id,
  base,
  venue,
  symbol: id.split(':')[1],
  price: base === 'BTC' ? 100000 : base === 'ETH' ? 4000 : 200,
  priceBasis: venue === 'binance' ? 'last' : 'mark',
  timestampBasis: venue === 'binance' ? 'exchange' : 'received',
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
  await page.route('**/api/perpetual?**', (route) => {
    const assetId = new URL(route.request().url()).searchParams.get('asset');
    const hyper = assetId?.startsWith('hyperliquid:');
    return route.fulfill({ json: {
      assetId, status: 'live', markPrice: 100010, referencePrice: 100000,
      referenceKind: hyper ? 'oracle' : 'index', premiumPct: 0.01,
      fundingRate: hyper ? -0.0000125 : 0.0001, intervalHours: hyper ? 1 : 4,
      nextFundingAt: Date.now() + 3600_000,
      nextFundingSource: hyper ? 'hourly_schedule' : 'exchange',
      asOf: Date.now(), timestampBasis: hyper ? 'received' : 'exchange',
    } });
  });
  await page.route('**/api/asset?**', (route) =>
    route.fulfill({
      json: {
        id: new URL(route.request().url()).searchParams.get('asset'),
        tf: new URL(route.request().url()).searchParams.get('tf'),
        openInterestUsd: 100_000_000,
        benchmarkOI: { id: new URL(route.request().url()).searchParams.get('asset'), usd: 100_000_000, ratio: 1, venueMatched: true },
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
  await page.route('**/api/statarb/scan', route => route.fulfill({json:{scan:null}}));
  await page.route('**/api/watchlist**', (route) => route.fulfill({ json: { assetIds: [] } }));
  await page.route('**/api/alerts', (route) => route.fulfill({ json: { alerts: [], events: [] } }));
});
test('categories filter contracts and open the selected venue chart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  const chips = page.getByRole('group', { name: 'Asset categories' });
  await chips.getByRole('button', { name: /^Perps/ }).click();
  await expect(page.getByRole('button', { name: 'Chart HYPE on hyperliquid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chart BTC on binance' })).toHaveCount(0);
  await chips.getByRole('button', { name: /^L1/ }).click();
  await expect(page.getByRole('button', { name: 'Chart ETH on binance' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chart ETH on hyperliquid' })).toBeVisible();
  await page.getByLabel('Search category assets').fill('ETH');
  await page.getByLabel('Category exchange').selectOption('hyperliquid');
  await expect(page.getByRole('button', { name: 'Chart ETH on binance' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Chart ETH on hyperliquid' }).click();
  await expect(page.getByLabel('Selected asset')).toHaveValue('hyperliquid:ETH');
  await expect(page.getByRole('img', { name: 'ETH 1h interactive price and volume chart' })).toBeVisible();
  await expect(page.getByLabel('Market category')).toHaveValue('l1');
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await chips.getByRole('button', { name: /^AI/ }).click();
  await expect(page.getByText('No current contracts match this category and search.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('market-categories.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('TradingView account shortcut validates layouts and survives reload', async ({ page }) => {
  await page.goto('/');
  const open = () => page.getByText('My TradingView · account & saved indicators', { exact: true }).click();
  await open();
  await expect(page.getByRole('link', { name: 'Open TradingView chart' })).toHaveAttribute('href', /symbol=BINANCE%3ABTCUSDT.P/);
  const input = page.getByLabel('Saved TradingView layout URL (optional)');
  await input.fill('https://evil.test/chart/abc/');
  await page.getByRole('button', { name: 'Save layout shortcut' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enter an HTTPS TradingView' })).toBeVisible();
  await input.fill('https://www.tradingview.com/chart/Ab12Cd34/');
  await page.getByRole('button', { name: 'Save layout shortcut' }).click();
  await page.reload();
  await open();
  await expect(page.getByRole('link', { name: 'Open my saved layout' })).toHaveAttribute('href', 'https://www.tradingview.com/chart/Ab12Cd34/');
  await input.fill('');
  await page.getByRole('button', { name: 'Save layout shortcut' }).click();
  await expect(page.getByRole('link', { name: 'Open my saved layout' })).toHaveCount(0);
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

test('market snapshots poll every 10 seconds and refresh immediately after resume and reconnect', async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/markets') requests++;
  });
  await page.goto('/');
  const refresh = page.getByRole('button', { name: 'Refresh markets' });
  await expect(refresh).toBeEnabled();
  const initial = requests;
  await page.clock.fastForward(10_000);
  await expect.poll(() => requests).toBeGreaterThan(initial);
  await expect(refresh).toBeEnabled();

  // A suspended/background app should not poll, then must refresh on return
  // instead of waiting through another full polling interval.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  const beforeHidden = requests;
  await page.clock.fastForward(60_000);
  expect(requests).toBe(beforeHidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await expect.poll(() => requests).toBeGreaterThan(beforeHidden);
  await expect(refresh).toBeEnabled();

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(refresh).toBeDisabled();
  const beforeReconnect = requests;
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => requests).toBeGreaterThan(beforeReconnect);
  await expect(refresh).toBeEnabled();

  const beforeManual = requests;
  await refresh.click();
  await expect.poll(() => requests).toBeGreaterThan(beforeManual);
  await expect(refresh).toBeEnabled();
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
  // E2E uses the Vite dev server without a registered production service
  // worker. Warm the lazy tab module before blocking network; cold offline
  // installation is separately validated on the installed iPhone PWA.
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await mobileNav.getByRole('button', { name: 'Signals' }).click();
  await expect(page.getByText('Four-model entry scanner')).toBeVisible();
  await mobileNav.getByRole('button', { name: 'Markets' }).click();
  await expect(page.getByText('Market overview')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Strategy Lab' })).toBeVisible();
  await expect(page.getByText('No datasets stored. Fetch historical candles to begin.')).toBeVisible();
  await page.getByRole('button', { name: /Fetch & archive history/ }).click();
  await expect(page.getByRole('combobox', { name: 'Historical dataset', exact: true })).toHaveValue(dataset.id);
  const configForm = page.getByRole('region', { name: 'Backtest settings' }).locator('form');
  expect(await configForm.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(true);
  await page.getByRole('button', { name: /Run research backtest/ }).click();
  await expect.poll(async () => {
    const alerts = await page.locator('.lab-error').allTextContents();
    if (alerts.length) return 'API/render error: ' + alerts.join(' | ');
    return await page.getByRole('heading', { name: 'Backtest results' }).count() ? 'report' : 'pending';
  }, { timeout: 12_000 }).toBe('report');
  await expect(page.getByRole('heading', { name: 'Backtest results' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Backtest trade log' })).toBeVisible();
  await expect(page.getByText(/Holdout contains fewer than 30/)).toBeVisible();
  await expect(page.getByText(/RESEARCH REPORT/)).toBeVisible();
});

test('perpetual details label price bases and funding interval without mixed-basis comparisons', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('heading', { name: 'Perpetual pricing & funding' }).locator('..').locator('..');
  await expect(panel.getByText('Reported funding · per 4h')).toBeVisible();
  await expect(panel.locator('.perpetual-grid > div').filter({ hasText: 'Reported funding' }).getByText('+0.0100%', { exact: true })).toBeVisible();
  await expect(panel.getByText('Longs pay shorts')).toBeVisible();
  await expect(panel.getByText('Exchange schedule', { exact: false })).toBeVisible();
  await expect(page.getByText('Last trade price', { exact: true })).toBeVisible();
  const hyperRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Inspect ETH on hyperliquid' }) });
  await expect(hyperRow.getByRole('cell').nth(3)).toHaveText('N/A');
  await expect(hyperRow.getByText('Mark', { exact: true })).toBeVisible();
  await page.getByLabel('Selected asset').selectOption(ethHyper.id);
  await expect(page.getByText('Mark price', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('Hyperliquid supplies mark and oracle prices;', { exact: false })).toBeHidden();
  await panel.getByText('Price and funding details', { exact: true }).click();
  await expect(panel.getByText('Hyperliquid supplies mark and oracle prices;', { exact: false })).toBeVisible();
  await expect(panel.getByText('Reported funding · per 1h')).toBeVisible();
  await expect(panel.getByText('Shorts pay longs')).toBeVisible();
  await expect(panel.getByText('Hourly schedule estimate', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByText('Price and funding details', { exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('perpetual-pricing.png'), fullPage: true });
});

test('funding errors remain unavailable and stale cached quotes are visibly labelled', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const panel = page.getByRole('heading', { name: 'Perpetual pricing & funding' }).locator('..').locator('..');
  await expect(panel.getByText('Current snapshot')).toBeVisible();
  await page.route('**/api/perpetual?**', (route) => route.fulfill({ status: 503, json: { error: 'Feed unavailable' } }));
  await page.clock.fastForward(10_000);
  await expect(panel.getByText('Stale · last reported')).toBeVisible();
  await page.getByLabel('Selected asset').selectOption(eth.id);
  await expect(panel.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('Reported funding · interval unknown')).toBeVisible();
  await expect(panel.getByText('Age unknown')).toBeVisible();
  await expect(panel.getByText('Longs pay shorts')).toHaveCount(0);
});

test('saved markets persist after reload, select the correct venue and recover from failed saves', async ({ page }) => {
  let saved = ['hyperliquid:HYPE'];
  let fail = false;
  await page.route('**/api/watchlist**', (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && fail) return route.fulfill({ status: 503, json: { error: 'Could not persist watchlist' } });
    if (request.method() === 'POST') saved = [...new Set([...saved, request.postDataJSON().assetId as string])];
    if (request.method() === 'DELETE') saved = saved.filter((id) => id !== new URL(request.url()).searchParams.get('asset'));
    return route.fulfill({ json: { assetIds: saved } });
  });
  await page.goto('/');
  const watchlist = page.getByRole('heading', { name: 'Saved markets' }).locator('..').locator('..');
  await expect(watchlist.getByRole('button', { name: 'Inspect saved hyperliquid:HYPE' })).toBeVisible();
  await page.getByRole('button', { name: 'Save ETH on hyperliquid to watchlist' }).click();
  await expect(watchlist.getByRole('button', { name: 'Inspect saved hyperliquid:ETH' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove ETH on hyperliquid from watchlist' })).toHaveAttribute('aria-pressed', 'true');
  await watchlist.getByRole('button', { name: 'Inspect saved hyperliquid:ETH' }).click();
  await expect(page.getByLabel('Selected asset')).toHaveValue('hyperliquid:ETH');
  await watchlist.getByRole('button', { name: 'Remove hyperliquid:HYPE from watchlist' }).click();
  await expect(watchlist.getByRole('button', { name: 'Inspect saved hyperliquid:HYPE' })).toHaveCount(0);
  fail = true;
  await page.getByRole('button', { name: 'Save BTC on binance to watchlist' }).click();
  await expect(watchlist.getByText('Could not persist watchlist', { exact: false })).toBeVisible();
  await expect(watchlist.getByRole('button', { name: 'Inspect saved binance:BTCUSDT' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Save BTC on binance to watchlist' }).click();
  await expect(watchlist.getByRole('button', { name: 'Inspect saved binance:BTCUSDT' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Strategy Lab v2 reports open-position drawdown and sends the exposure cap', async ({ page }) => {
  const dataset = { id: 'b'.repeat(64), assetId: btc.id, venue: 'binance', interval: '1h', capturedAt: Date.now(), firstOpenTime: 1, lastCloseTime: Date.now() - 1, bars: 100 };
  await page.route('**/api/research/datasets', (route) => route.fulfill({ json: { datasets: [dataset], rejected: 0 } }));
  let submittedCap: number | undefined;
  await page.route('**/api/research/backtests', (route) => {
    const input = route.request().postDataJSON() as { config: { maxGrossLeverage: number } };
    submittedCap = input.config.maxGrossLeverage;
    return route.fulfill({ json: { schemaVersion: 1, engineVersion: 'single-position-next-bar-v2', dataset,
      result: { hypothesis: 'Synthetic UI test, not market evidence.', config: { ...input.config, initialEquity: 10000 }, bars: 100, splitIndex: 75, trades: [],
        equityCurve: [{ time: 1, value: 10000, position: 'flat', sample: 'development' }, { time: 2, value: 9800, position: 'long', sample: 'development' }],
        summary: { count: 0, netPnl: 0, expectancyR: null, maxDrawdownPct: 0, maxOpenEquityDrawdownPct: 2, maxEntryGrossLeverage: 0, sizeCappedCount: 0, winRate: null },
        development: { count: 0, netPnl: 0, expectancyR: null }, holdout: { count: 0, netPnl: 0, expectancyR: null }, warnings: ['Funding and intrabar risk are not modeled.'] } } });
  });
  await page.goto('/');
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await (await mobileNav.isVisible() ? mobileNav.getByRole('button', { name: 'Lab' }) : page.getByRole('button', { name: 'Strategy Lab', exact: true })).click();
  await expect(page.getByLabel('Maximum gross exposure')).toHaveValue('1');
  await page.getByLabel('Maximum gross exposure').fill('1.5');
  await page.getByRole('button', { name: 'Run research backtest' }).click();
  await expect(page.getByRole('heading', { name: 'Bar-close equity · open and closed trades' })).toBeVisible();
  await expect(page.getByText('Bar-close max drawdown', { exact: true })).toBeVisible();
  await expect(page.getByText('2.00%', { exact: true })).toBeVisible();
  await expect(page.getByText('historical mark prices, intrabar excursions and funding are excluded.', { exact: false })).toBeVisible();
  expect(submittedCap).toBe(1.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('stat-arb research preserves its evidence boundary and all synthetic folds', async ({ page }) => {
  await page.goto('/');
  // Both responsive navs can be in the DOM; choose the rendered control.
  await page.getByRole('button', { name: /^(Correlation|Pairs)$/ }).filter({ visible: true }).click();
  await page.getByRole('group',{name:'Correlation lab views'}).getByRole('button', { name: 'Stat-arb scanner', exact: true }).click();
  await page.getByRole('button',{name:'Show original research protocol',exact:true}).click();
  await expect(page.getByRole('heading', { name: 'Crypto stat-arb research', exact: true })).toBeVisible();
  await expect(page.getByText('No tradable edge established.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Development walk-forward', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show original synthetic demo' }).click();
  await expect(page.getByRole('heading', { name: 'SYNTHETIC · mechanical demonstration only' })).toBeVisible();
  const folds = page.getByRole('region', { name: 'Development walk-forward folds' });
  await expect(folds.getByRole('row')).toHaveCount(5);
  await expect(folds.getByText('None · abstained', { exact: true })).toHaveCount(3);
  await expect(page.getByText('Not opened; no holdout results supplied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByLabel('Import stat-arb report', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"liveReady":true}') });
  await expect(page.getByRole('alert')).toContainText('Import rejected');
  await expect(page.getByRole('heading', { name: 'Development walk-forward', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Development walk-forward', exact: true })).toHaveCount(0);
  await page.getByLabel('Import stat-arb report', { exact: true }).setInputFiles({ name: 'original-demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(statarbDemo)) });
  await expect(page.getByRole('heading', { name: 'SYNTHETIC · mechanical demonstration only' })).toBeVisible();
  await expect(folds.getByRole('row')).toHaveCount(5);
});

test('terminal layouts save, reload, apply and delete on this device', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Saved terminal layouts · 0', { exact: true }).click();
  await page.getByLabel('Market category', { exact: true }).selectOption('ai');
  await page.getByLabel('Layout name', { exact: true }).fill('AI research');
  await page.getByRole('button', { name: 'Save current layout', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Layouts saved on this device.' })).toBeVisible();
  await page.reload();
  await page.getByText('Saved terminal layouts · 1', { exact: true }).click();
  await expect(page.getByLabel('Market category', { exact: true })).toHaveValue('all');
  await page.getByRole('button', { name: 'AI research', exact: true }).click();
  await expect(page.getByLabel('Market category', { exact: true })).toHaveValue('ai');
  await page.getByRole('button', { name: 'Delete layout AI research', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Saved terminal layouts · 0', { exact: true })).toBeVisible();
});


async function mockDevicePush(page: Page) {
  await page.addInitScript(() => {
    const endpoint = 'https://push.example/this-device';
    const subscription = {
      endpoint,
      keys: { p256dh: 'test-key', auth: 'test-auth' },
      unsubscribe: async () => { localStorage.removeItem('test.push.active'); return true; },
      toJSON: () => ({ endpoint, keys: { p256dh: 'test-key', auth: 'test-auth' } }),
    };
    const registration = { pushManager: {
      getSubscription: async () => localStorage.getItem('test.push.active') ? subscription : null,
      subscribe: async () => { localStorage.setItem('test.push.active', 'yes'); return subscription; },
    } };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: async () => registration });
    if (!('PushManager' in window)) Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'granted' } });
  });
  await page.route('**/api/push/key', (route) => route.fulfill({ json: { key: 'BAAA' } }));
  await page.route('**/api/push/subscribe', (route) => route.fulfill({ json: { ok: true } }));
}

test('push notification toggle follows subscription across enable, reload and disable', async ({ page }) => {
  await mockDevicePush(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Enable iPhone push notifications', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable iPhone push notifications', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable iPhone push notifications', exact: true })).toBeVisible();
  const removed = page.waitForRequest((request) => request.url().endsWith('/api/push/subscribe') && request.method() === 'DELETE');
  await page.getByRole('button', { name: 'Disable iPhone push notifications', exact: true }).click();
  expect((await removed).postDataJSON()).toEqual({ endpoint: 'https://push.example/this-device' });
  await expect(page.getByRole('button', { name: 'Enable iPhone push notifications', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable iPhone push notifications', exact: true })).toBeVisible();
});

test('push notification toggle preserves disable action after server failure', async ({ page }) => {
  await mockDevicePush(page);
  await page.addInitScript(() => localStorage.setItem('test.push.active', 'yes'));
  await page.route('**/api/push/subscribe', (route) => route.fulfill({ status: 503, json: { error: 'Disk unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Disable iPhone push notifications', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Could not disable push notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disable iPhone push notifications', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('test.push.active'))).toBe('yes');
});

test('push notification toggle rolls back a new device subscription when saving fails', async ({ page }) => {
  await mockDevicePush(page);
  await page.route('**/api/push/subscribe', (route) => route.fulfill({ status: 503, json: { error: 'Disk unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Enable iPhone push notifications', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Push subscription failed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable iPhone push notifications', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('test.push.active'))).toBeNull();
});

test('price range alert validates bounds, saves, reloads and removes', async ({ page }) => {
  let rules: Record<string, unknown>[] = [];
  await page.route('**/api/alerts', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input).toEqual({ assetId: 'binance:BTCUSDT', kind: 'price_range', lowerPrice: 90000, upperPrice: 110000 });
      const alert = { ...input, id: '00000000-0000-4000-8000-000000000001', createdAt: Date.now(), enabled: true };
      rules = [alert]; await route.fulfill({ status: 201, json: { alert } });
    } else await route.fulfill({ json: { alerts: rules, events: [] } });
  });
  await page.route('**/api/alerts/*', async (route) => { rules = []; await route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('combobox', { name: 'Alert type', exact: true }).selectOption('price_range');
  await page.getByLabel('Lower price (USD)', { exact: true }).fill('120000');
  await page.getByLabel('Upper price (USD)', { exact: true }).fill('110000');
  await expect(page.getByRole('button', { name: 'Create alert', exact: true })).toBeDisabled();
  await expect(page.getByText('Lower price must be less than upper price.', { exact: true })).toBeVisible();
  await page.getByLabel('Lower price (USD)', { exact: true }).fill('90000');
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  await expect(page.getByText('BTCUSDT · PRICE RANGE', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.getByText('BTCUSDT · PRICE RANGE', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Delete alert', exact: true }).click();
  await expect(page.getByText('No active alerts. Choose a rule on the left.', { exact: true })).toBeVisible();
});

test('price level direction follows the selected level and displays the server-confirmed rule', async ({ page }) => {
  const rules: Record<string, unknown>[] = [];
  await page.route('**/api/alerts', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input.direction).toBeUndefined();
      const alert = { ...input, direction: input.threshold < 100000 ? 'below' : 'above', referencePrice: 100000, id: crypto.randomUUID(), createdAt: Date.now(), enabled: true };
      rules.push(alert); await route.fulfill({ status: 201, json: { alert } });
    } else await route.fulfill({ json: { alerts: rules, events: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('combobox', { name: 'Alert type', exact: true }).selectOption('price');
  const input = page.getByRole('spinbutton', { name: 'Price level (USD)', exact: true });
  await expect(page.getByRole('button', { name: 'Create alert', exact: true })).toBeDisabled();
  await input.fill('90000');
  await expect(page.getByText('Price below $90,000.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  await expect(page.locator('.alert-rule')).toContainText('Price below $90,000.00');
  await input.fill('110000');
  await expect(page.getByText('Price above $110,000.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create alert', exact: true }).click();
  await expect(page.locator('.alert-rule')).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.locator('.alert-rule').nth(1)).toContainText('Price above $110,000.00');
});

test('chart drawings support touch or mouse, undo, reload, scale changes and market isolation', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const canvas = page.getByRole('img', { name: 'BTC 1h interactive price and volume chart' });
  await expect(canvas).toBeVisible();
  const mark = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const options = { position: { x: box.width * x, y: box.height * y } };
    if (isMobile) await canvas.tap(options); else await canvas.click(options);
  };
  await page.getByRole('button', { name: 'Horizontal level', exact: true }).click();
  await mark(0.4, 0.25);
  await expect(page.getByText('1 / 50 drawings', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Trend line', exact: true }).click();
  await mark(0.3, 0.3); await mark(0.6, 0.4);
  await expect(page.getByText('2 / 50 drawings', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await mark(0.3, 0.2); await mark(0.55, 0.45);
  await expect(page.getByText('3 / 50 drawings', { exact: false })).toBeVisible();
  await page.locator('.trading-chart').screenshot({path: test.info().outputPath('chart-drawings.png')});
  const rail = await page.getByRole('toolbar', { name: 'Drawing tools' }).boundingBox();
  const plot = await canvas.boundingBox();
  expect(rail!.x + rail!.width).toBeLessThanOrEqual(plot!.x);
  await page.getByRole('button', { name: 'Log price scale', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log price scale', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Auto price scale', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto price scale', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Auto price scale', exact: true }).click();
  await page.getByRole('button', { name: 'Log price scale', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('fluxdesk:drawings:v1:binance:BTCUSDT:1h'));
  expect(JSON.parse(saved!).map((d: {kind: string}) => d.kind)).toEqual(['horizontal', 'trend', 'rectangle']);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in chart' }).click();
  await page.getByRole('button', { name: 'Pan chart earlier' }).click();
  await page.getByRole('button', { name: 'Expand chart', exact: true }).click();
  await page.getByRole('button', { name: 'Close expanded chart' }).click();
  expect(await page.evaluate(() => localStorage.getItem('fluxdesk:drawings:v1:binance:BTCUSDT:1h'))).toBe(saved);
  await page.reload();
  await expect(page.getByText('3 / 50 drawings', { exact: false })).toBeVisible();
  await page.getByText('Manage drawings (3)', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete drawing 2', exact: true }).click();
  await expect(page.getByText('2 / 50 drawings', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  await expect(page.getByText('3 / 50 drawings', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Clear drawings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear drawings', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
  await page.getByLabel('Selected asset', { exact: true }).selectOption('binance:ETHUSDT');
  await expect(page.getByRole('button', { name: 'Clear drawings', exact: true })).toBeDisabled();
  await page.getByLabel('Selected asset', { exact: true }).selectOption('binance:BTCUSDT');
  await expect(page.getByText('3 / 50 drawings', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Stay in drawing mode' }).click();
  await page.getByRole('button', { name: 'Horizontal level', exact: true }).click();
  await mark(0.4, 0.25); await mark(0.5, 0.35);
  await expect(page.getByRole('button', { name: 'Horizontal level', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cursor', exact: true }).click();
  await expect(page.getByText('5 / 50 drawings', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('historical funding enrichment selects a new snapshot and discloses accounting limits', async ({ page }) => {
  const original = { id: 'a'.repeat(64), assetId: btc.id, venue: 'binance', interval: '1h', capturedAt: Date.now(), firstOpenTime: Date.now() - 80 * 3600000, lastCloseTime: Date.now() - 1, bars: 80 };
  const enriched = { ...original, id: 'b'.repeat(64), marketHistory: { retrievedAt: Date.now(), fundingEvents: 10, markBars: 80, fundingCoverage: 'observed_unverified', firstMarkClose: 99000, lastMarkClose: 100000, recentFunding: [{time: Date.now() - 8 * 3600000, rate: -0.0001, markPrice: 100000, rateType: 'Regular'}] } };
  let snapshots = [original]; let reject = true;
  await page.route('**/api/research/datasets', (route) => route.fulfill({json: {datasets: snapshots, rejected: 0}}));
  await page.route('**/api/research/market-history', (route) => {
    expect(route.request().postDataJSON()).toEqual({datasetId: original.id});
    if (reject) return route.fulfill({status: 503, json: {error: 'Historical source unavailable'}});
    snapshots = [enriched, original]; return route.fulfill({status: 201, json: {dataset: enriched}});
  });
  await page.goto('/');
  const openLab = async () => {
    const mobile = page.getByRole('navigation', {name: 'Mobile navigation'});
    await (await mobile.isVisible() ? mobile.getByRole('button', {name: 'Lab', exact: true}) : page.getByRole('button', {name: 'Strategy Lab', exact: true})).click();
  };
  await openLab();
  await page.getByRole('button', {name: 'Archive funding & mark history', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Historical source unavailable');
  await expect(page.getByLabel('Historical dataset', {exact: true})).toHaveValue(original.id);
  reject = false;
  await page.getByRole('button', {name: 'Archive funding & mark history', exact: true}).click();
  await expect(page.getByLabel('Historical dataset', {exact: true})).toHaveValue(enriched.id);
  await expect(page.getByText('10 observed funding payments', {exact: false})).toBeVisible();
  await page.getByText('Latest archived payments · UTC', {exact: true}).click();
  await expect(page.getByRole('table', {name: 'Archived funding payments'})).toContainText('-0.010000%');
  await expect(page.getByText('Payment schedule completeness remains unaudited.', {exact: false})).toBeVisible();
  await expect(page.getByText('No research report yet.', {exact: false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await openLab();
  await expect(page.getByLabel('Historical dataset', {exact: true})).toHaveValue(enriched.id);
});

test('exploratory funding mode uses an enriched snapshot and exports its versioned report', async ({ page }) => {
  const dataset = {id:'c'.repeat(64),assetId:btc.id,venue:'binance',interval:'1h',capturedAt:Date.now(),firstOpenTime:1,lastCloseTime:Date.now()-1,bars:100,marketHistory:{retrievedAt:Date.now(),fundingEvents:12,markBars:100,fundingCoverage:'observed_unverified',recentFunding:[],firstMarkClose:100,lastMarkClose:101}};
  await page.route('**/api/research/datasets',r=>r.fulfill({json:{datasets:[dataset],rejected:0}}));
  await page.route('**/api/research/backtests',r=>{
    const input=r.request().postDataJSON(); expect(input.config.historicalAccounting).toBe(true);
    const stats={count:0,netPnl:0,expectancyR:null};
    return r.fulfill({json:{schemaVersion:1,engineVersion:'observed-funding-mark-v3',dataset,result:{accounting:'observed-funding-mark-v3',hypothesis:'Synthetic mechanics fixture',config:input.config,bars:100,splitIndex:75,trades:[],equityCurve:[{time:1,value:10000,position:'flat',sample:'development'}],summary:{...stats,maxDrawdownPct:0,maxOpenEquityDrawdownPct:0,winRate:null},development:stats,holdout:stats,warnings:['Payment completeness remains unaudited.']}}});
  });
  await page.goto('/'); const nav=page.getByRole('navigation',{name:'Mobile navigation'});
  await (await nav.isVisible()?nav.getByRole('button',{name:'Lab',exact:true}):page.getByRole('button',{name:'Strategy Lab',exact:true})).click();
  const option=page.getByRole('checkbox',{name:'Use archived funding and mark prices'});
  await expect(option).not.toBeChecked();await option.check();
  await page.getByRole('button',{name:'Run research backtest',exact:true}).click();
  await expect(page.getByText('ENGINE: observed-funding-mark-v3',{exact:true})).toBeVisible();
  await expect(page.getByText('Includes observed historical funding',{exact:false})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download research report (JSON)'}).click();
  expect((await download).suggestedFilename()).toContain('observed-funding-mark-v3');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('funding coverage exposes observed gaps without claiming missing-payment counts', async ({page})=>{
 const dataset={id:'d'.repeat(64),assetId:btc.id,venue:'binance',interval:'1h',capturedAt:Date.now(),firstOpenTime:1,lastCloseTime:Date.now()-1,bars:100,marketHistory:{retrievedAt:Date.now(),fundingEvents:3,markBars:100,fundingCoverage:'observed_unverified',firstMarkClose:100,lastMarkClose:101,recentFunding:[],diagnostics:{status:'review_required',regularOrUnspecifiedPayments:3,specialPayments:0,unspecifiedTypes:1,positiveRates:2,negativeRates:1,zeroRates:0,firstPaymentAt:3600000,lastPaymentAt:72000000,leadingGapHours:1,trailingGapHours:10,spacingHours:[{hours:4,count:1},{hours:16,count:1}],spacingVariantCount:2,gapsOver8h:[{from:14400000,to:72000000,hours:16}],gapCountOver8h:1,largestMarkTradeCloseDifferencePct:2}}};
 await page.route('**/api/research/datasets',r=>r.fulfill({json:{datasets:[dataset],rejected:0}}));
 await page.goto('/');const nav=page.getByRole('navigation',{name:'Mobile navigation'});await (await nav.isVisible()?nav.getByRole('button',{name:'Lab',exact:true}):page.getByRole('button',{name:'Strategy Lab',exact:true})).click();
 await page.getByText('Funding coverage · review required',{exact:true}).click();
 const panel=page.getByLabel('Funding coverage diagnostics',{exact:true});
 await expect(panel).toContainText('not a count of missing payments');
 await expect(panel.getByRole('table',{name:'Funding gaps for review'})).toContainText('16.00h');
 await expect(panel).toContainText('2.0000%');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('journal saves dated fills and daily reviews, reloads and exports with closed-trade analytics', async ({page})=>{
 let trades:Record<string,unknown>[]=[],days:Record<string,unknown>[]=[];
 await page.route('**/api/journal',r=>r.fulfill({json:{schemaVersion:1,trades,days}}));
 await page.route('**/api/journal/trades',r=>{const input=r.request().postDataJSON();const trade={...input,id:input.id||'journal-test-1',revision:input.revision+1,createdAt:Date.now(),updatedAt:Date.now()};trades=[trade];return r.fulfill({status:201,json:{trade}});});
 await page.route('**/api/journal/day',r=>{const input=r.request().postDataJSON();const day={...input,revision:input.revision+1,updatedAt:Date.now()};days=[day];return r.fulfill({json:{day}});});
 await page.goto('/');const nav=page.getByRole('navigation',{name:'Mobile navigation'});const open=async()=>{await (await nav.isVisible()?nav.getByRole('button',{name:'Journal',exact:true}):page.getByRole('button',{name:'Trade journal',exact:true})).click();};await open();
 await page.getByLabel('Selected journal date',{exact:true}).fill('2026-10-24');
 await page.getByRole('button',{name:'New trade',exact:true}).click();
 await page.getByLabel('Trade title',{exact:true}).fill('BTC disciplined trade');
 await page.getByLabel('Planned risk (USD)',{exact:true}).fill('10');
 await page.getByLabel('Tags (comma separated)',{exact:true}).pressSequentially('mean reversion,crypto');
 await expect(page.getByLabel('Tags (comma separated)',{exact:true})).toHaveValue('mean reversion,crypto');
 await page.getByRole('button',{name:'Add entry fill · leg 1',exact:true}).click();
 await page.getByLabel('Leg 1 fill 1 quantity',{exact:true}).fill('');await page.getByLabel('Leg 1 fill 1 quantity',{exact:true}).pressSequentially('0.25');await expect(page.getByLabel('Leg 1 fill 1 quantity',{exact:true})).toHaveValue('0.25');await page.getByLabel('Leg 1 fill 1 quantity',{exact:true}).fill('1');await page.getByLabel('Leg 1 fill 1 price',{exact:true}).fill('100');await page.getByLabel('Leg 1 fill 1 fee',{exact:true}).fill('1');
 await page.getByRole('button',{name:'Add exit fill · leg 1',exact:true}).click();
 await page.getByLabel('Leg 1 fill 2 quantity',{exact:true}).fill('1');await page.getByLabel('Leg 1 fill 2 price',{exact:true}).fill('110');await page.getByLabel('Leg 1 fill 2 fee',{exact:true}).fill('1');
 await page.getByLabel('Funding cash flow (USD; received + / paid −)',{exact:true}).fill('');await page.getByLabel('Funding cash flow (USD; received + / paid −)',{exact:true}).pressSequentially('-2');await expect(page.getByLabel('Funding cash flow (USD; received + / paid −)',{exact:true})).toHaveValue('-2');
 await page.getByLabel('Post-trade review',{exact:true}).fill('Followed the stop and plan.');
 const screenshots=page.getByRole('textbox',{name:'Screenshot/chart HTTPS links (one per line)',exact:true});await screenshots.fill('https://example.com/entry.png');await screenshots.press('Enter');await screenshots.pressSequentially('https://example.com/exit.png');await expect(screenshots).toHaveValue('https://example.com/entry.png\nhttps://example.com/exit.png');
 await page.getByRole('button',{name:'Save trade',exact:true}).click();
 await expect(page.getByText('Trade saved on your server.',{exact:true})).toBeVisible();
 expect(trades[0]?.tags).toEqual(['mean reversion','crypto']);expect(trades[0]?.screenshotUrls).toEqual(['https://example.com/entry.png','https://example.com/exit.png']);
 await expect(page.locator('.journal-trade')).toContainText('BTC disciplined trade');
 await page.getByRole('textbox',{name:'Daily plan / risk rules',exact:true}).fill('One good trade only.');await page.getByRole('button',{name:'Save daily note',exact:true}).click();
 await expect(page.getByText('Daily note saved.',{exact:true})).toBeVisible();
 await page.reload();await open();await page.getByLabel('Selected journal date',{exact:true}).fill('2026-10-24');await expect(page.getByRole('textbox',{name:'Daily plan / risk rules',exact:true})).toHaveValue('One good trade only.');
 await page.getByRole('button',{name:'Journal analytics',exact:true}).click();await expect(page.getByText('$6.00',{exact:true}).first()).toBeVisible();
 await page.locator('.workspace').screenshot({path:test.info().outputPath('journal-analytics.png')});
 await page.getByRole('button',{name:'P&L calendar',exact:true}).click();await expect(page.getByRole('button',{name:'Journal day 2026-10-24',exact:true})).toContainText('1 trades');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export complete journal JSON',exact:true}).click();expect((await download).suggestedFilename()).toContain('fluxdesk-journal');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('stat-arb scanner selects venue and timeframe, shows ±2 candidates and seeds a two-leg journal draft', async ({page})=>{
 let scan:Record<string,unknown>|null=null;
 const pair={y:'hyperliquid:ETH',x:'hyperliquid:BTC',beta:1.2,intercept:0.2,adf:-4.1,critical1:-3.9,critical5:-3.3,critical10:-3.1,level:'1%',z:-2.5,halfLife:12,betaDrift:0.2,sample:180,lastSpread:-0.03,spreadMean:0,spreadSd:0.012,observedAt:Date.now(),signalTime:Date.now()-3600000,direction:'long_spread',longLeg:'hyperliquid:ETH',shortLeg:'hyperliquid:BTC',outsideStop:false,warnings:[]};
 await page.route('**/api/statarb/scan',r=>{if(r.request().method()==='POST'){const config=r.request().postDataJSON();expect(config).toEqual({venue:'hyperliquid',timeframe:'15m',formationBars:180,preset:'crypto'});scan={id:'scan-test',config,status:'done',startedAt:Date.now(),finishedAt:Date.now(),universe:40,loaded:39,failed:[{asset:'hyperliquid:NEW',reason:'Insufficient history'}],tested:741,invalidPairs:1,totalPairs:741,passed:1,opportunities:1,results:[pair]};return r.fulfill({status:202,json:{scan}});}return r.fulfill({json:{scan}});});
 await page.route('**/api/journal',r=>r.fulfill({json:{schemaVersion:1,trades:[],days:[]}}));
 await page.goto('/');const nav=page.getByRole('navigation',{name:'Mobile navigation'});await (await nav.isVisible()?nav.getByRole('button',{name:'Stat-arb',exact:true}):page.getByRole('button',{name:'Stat-arb scanner',exact:true})).click();
 await page.getByRole('combobox',{name:'Scanner venue',exact:true}).selectOption('hyperliquid');await page.getByRole('combobox',{name:'Scanner timeframe',exact:true}).selectOption('15m');await page.getByRole('combobox',{name:'Formation bars',exact:true}).selectOption('180');
 await page.getByRole('button',{name:'Scan all venue assets',exact:true}).click();await expect(page.getByText('-2.50',{exact:true})).toBeVisible();await expect(page.getByText('Long ETH / short BTC',{exact:false})).toBeVisible();
 await page.locator('.workspace').screenshot({path:test.info().outputPath('statarb-scanner.png')});
 await page.getByRole('combobox',{name:'Rank candidates',exact:true}).selectOption('deviation');
 await page.reload();await (await nav.isVisible()?nav.getByRole('button',{name:'Stat-arb',exact:true}):page.getByRole('button',{name:'Stat-arb scanner',exact:true})).click();
 await expect(page.getByRole('combobox',{name:'Scanner venue',exact:true})).toHaveValue('hyperliquid');await expect(page.getByRole('combobox',{name:'Scanner timeframe',exact:true})).toHaveValue('15m');await expect(page.getByRole('combobox',{name:'Rank candidates',exact:true})).toHaveValue('deviation');await expect(page.getByText('rescan to refresh',{exact:false})).toBeVisible();
 await page.evaluate(()=>localStorage.setItem('fluxdesk.journal.draft.v1',JSON.stringify({title:'Unfinished manual trade'})));
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Journal pair',exact:true}).click();await expect(page.getByRole('heading',{name:'Venue-wide stat-arb scanner',exact:true})).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fluxdesk.journal.draft.v1')!).title)).toBe('Unfinished manual trade');expect(await page.evaluate(()=>sessionStorage.getItem('fluxdesk.journal.pair'))).toBeNull();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Journal pair',exact:true}).click();await expect(page.getByLabel('Trade title',{exact:true})).toHaveValue('ETH / BTC stat-arb');await expect(page.getByLabel('Leg 1 contract',{exact:true})).toHaveValue('hyperliquid:ETH');await expect(page.getByLabel('Leg 2 contract',{exact:true})).toHaveValue('hyperliquid:BTC');await expect(page.getByText('Scanner context:',{exact:false})).toContainText('z=-2.5');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('journal open-position estimates expire and the review queue clears saved completed records', async ({ page }) => {
  const t = newTrade('2026-10-24');
  t.id = 'open-position'; t.revision = 1; t.title = 'BTC position review';
  t.strategy = 'Trend'; t.plan = 'Follow stop'; t.riskUsd = 100;
  t.legs[0]!.fills = [{ id: 'entry', kind: 'entry', quantity: 1, price: 99000, feeUsd: 10, time: new Date().toISOString() }];
  let trades = [t], stale = false;
  await page.route('**/api/markets', r => r.fulfill({json: {
    assets: [{ ...btc, asOf: Date.now() - (stale ? 60000 : 0) }], asOf: Date.now(), checkedAt: Date.now(),
    feeds: [{ venue: 'binance', status: 'live', lastSuccessAt: Date.now(), lastAttemptAt: Date.now(), ageMs: 0, markets: 1 }],
  }}));
  await page.route('**/api/journal', r => r.fulfill({ json: { schemaVersion: 1, trades, days: [] } }));
  await page.route('**/api/journal/trades', r => {
    const saved = { ...r.request().postDataJSON(), revision: 2 }; trades = [saved];
    return r.fulfill({ status: 201, json: { trade: saved } });
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  const open = async () => { await (await nav.isVisible() ? nav.getByRole('button', { name: 'Journal', exact: true }) : page.getByRole('button', { name: 'Trade journal', exact: true })).click(); };
  await open();
  await page.getByRole('button', { name: 'Open positions', exact: true }).click();
  await expect(page.locator('.journal-trade')).toContainText('$1,000.00');
  await expect(page.locator('.journal-trade')).toContainText('$990.00');
  await expect(page.locator('.journal-trade')).toContainText('Incomplete');
  await page.getByRole('button', { name: 'Review queue', exact: true }).click();
  await expect(page.locator('.journal-trade')).toContainText('Record open-leg stops');
  await page.getByRole('button', { name: 'Complete trade review', exact: true }).click();
  await page.getByLabel('Initial stop', { exact: true }).fill('98000');
  await page.getByRole('button', { name: 'Save trade', exact: true }).click();
  await expect(page.getByText('No incomplete records match these filters.', { exact: true })).toBeVisible();
  stale = true;
  await page.reload(); await open();
  await page.getByRole('button', { name: 'Open positions', exact: true }).click();
  await expect(page.locator('.journal-trade')).toContainText('Current quote unavailable');
  await expect(page.locator('.journal-trade')).toContainText('Recorded stop: $98,000.00');
  await page.locator('.workspace').screenshot({ path: test.info().outputPath('journal-positions.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('journal review save travels through the real HTTP handler and survives a disk reload', async ({ page }) => {
  const { createServer } = await import('node:http');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { handler } = await import('../server/app.ts');
  const dir = await mkdtemp(join(tmpdir(), 'fluxdesk-browser-journal-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const backend = createServer((req, res) => { void handler(req, res); });
  try {
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const address = backend.address();
    if (!address || typeof address === 'string') throw Error('Missing test API address');
    const origin = `http://127.0.0.1:${address.port}`;
    const t = newTrade('2026-10-24');
    t.title = 'Persisted review'; t.strategy = 'Trend'; t.plan = 'Follow stop'; t.riskUsd = 100;
    t.legs[0]!.fills = [{ id: 'entry', kind: 'entry', quantity: 1, price: 99000, feeUsd: 10, time: new Date().toISOString() }];
    const seed = await fetch(origin + '/api/journal/trades', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(t) });
    expect(seed.status).toBe(201);
    await page.route('**/api/journal**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const response = await fetch(origin + url.pathname + url.search, {
        method: request.method(), headers: { 'content-type': 'application/json', origin },
        body: request.postData() ?? undefined,
      });
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    const open = async () => { await (await nav.isVisible() ? nav.getByRole('button', { name: 'Journal', exact: true }) : page.getByRole('button', { name: 'Trade journal', exact: true })).click(); };
    await open();
    await page.getByRole('button', { name: 'Review queue', exact: true }).click();
    await page.getByRole('button', { name: 'Complete trade review', exact: true }).click();
    await page.getByLabel('Initial stop', { exact: true }).fill('98000');
    await page.getByRole('button', { name: 'Save trade', exact: true }).click();
    await expect(page.getByText('Trade saved on your server.', { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8'));
    expect(saved.trades[0].revision).toBe(2);
    expect(saved.trades[0].legs[0].stop).toBe(98000);
    await page.reload(); await open();
    await page.getByRole('button', { name: 'Review queue', exact: true }).click();
    await expect(page.getByText('No incomplete records match these filters.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open positions', exact: true }).click();
    await expect(page.locator('.journal-trade')).toContainText('Recorded stop: $98,000.00');
  } finally {
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('chart live quote matches the dashboard through refresh, mode change, venue change and offline', async ({ page }) => {
  await page.clock.install();
  let value = 100000;
  await page.route('**/api/markets', route => route.fulfill({ json: {
    assets: [{ ...btc, price: value, asOf: Date.now() }, { ...ethHyper, price: 4000, asOf: Date.now() }],
    benchmarks: {}, asOf: Date.now(), checkedAt: Date.now(),
    feeds: ['binance', 'hyperliquid'].map(venue => ({ venue, status: 'live', lastSuccessAt: Date.now(), lastAttemptAt: Date.now(), ageMs: 0, markets: 1 })),
  } }));
  await page.route('**/api/asset?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const reference = params.get('asset')?.startsWith('hyperliquid:') ? 4000 : 100000;
    const realBars = candles.map((bar, i) => { const open = reference * (0.98 + i * 0.0001); return { ...bar, open, close: open + reference * 0.00005, high: open + reference * 0.0001, low: open - reference * 0.0001 }; });
    return route.fulfill({ json: { id: params.get('asset'), tf: params.get('tf'), candles: realBars, openInterestUsd: 100, benchmarkOI: null, liquidationPriceClusters: [], levels: [], signals: [], liquidations: { observedUsd: 0, available: true, windowCovered: true, count: 0, events: [], coverage: 'partial_snapshots' } } });
  });
  await page.goto('/');
  const quote = page.getByLabel('Chart current quote', { exact: true });
  await expect(quote).toContainText('Last trade $100,000.00');
  await expect(page.locator('.big-price')).toHaveText('$100,000.00');
  await expect(page.getByLabel('Candle OHLC values')).toContainText('Last closed candle');
  await expect(page.getByLabel('Candle OHLC values')).toContainText('C $99,495.00');
  value = 100123.45;
  await page.clock.runFor(10000);
  await expect(quote).toContainText('Last trade $100,123.45');
  await expect(page.locator('.big-price')).toHaveText('$100,123.45');
  await page.screenshot({ path: test.info().outputPath('clean-overview-live-price.png'), fullPage: true });
  await page.getByRole('group', { name: 'Chart controls' }).getByRole('button', { name: 'Line', exact: true }).click();
  await expect(quote).toContainText('$100,123.45');
  await page.getByLabel('Selected asset', { exact: true }).selectOption('hyperliquid:ETH');
  await expect(quote).toContainText('Mark $4,000.00');
  await expect(page.locator('.big-price')).toHaveText('$4,000.00');
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await expect(quote).toContainText('Live quote unavailable');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('rejects mismatched chart response identity instead of drawing another contract history', async ({ page }) => {
  await page.route('**/api/asset?**', route => route.fulfill({ json: { id: 'hyperliquid:WRONG', tf: '1h', candles } }));
  await page.goto('/');
  await expect(page.getByText('Chart response does not match the selected contract/timeframe', { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('img', { name: 'BTC 1h interactive price and volume chart' })).toHaveCount(0);
});

test('delayed journal saves preserve newer edits across navigation and keep other daily drafts', async ({ page }) => {
  let trades: Record<string, unknown>[] = [], days: Record<string, unknown>[] = [];
  let releaseTrade!: () => void, releaseDay!: () => void;
  const tradeGate = new Promise<void>(resolve => { releaseTrade = resolve; });
  const dayGate = new Promise<void>(resolve => { releaseDay = resolve; });
  let tradeRequests = 0, dayRequests = 0;
  await page.route('**/api/journal', r => r.fulfill({ json: { schemaVersion: 1, trades, days } }));
  await page.route('**/api/journal/trades', async r => {
    const input = r.request().postDataJSON();
    expect(input.deviceDraftId).toBeUndefined();
    if (++tradeRequests === 1) await tradeGate;
    const trade = { ...input, id: input.id || 'delayed-trade', revision: input.revision + 1, createdAt: 100, updatedAt: Date.now() };
    trades = [trade]; await r.fulfill({ status: 201, json: { trade } });
  });
  await page.route('**/api/journal/day', async r => {
    const input = r.request().postDataJSON();
    if (++dayRequests === 1) await dayGate;
    const day = { ...input, revision: input.revision + 1, updatedAt: Date.now() };
    days = [...days.filter(d => d.date !== day.date), day]; await r.fulfill({ json: { day } });
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  const open = async () => { await (await nav.isVisible() ? nav.getByRole('button', { name: 'Journal', exact: true }) : page.getByRole('button', { name: 'Trade journal', exact: true })).click(); };
  await open();
  await page.getByRole('button', { name: 'New trade', exact: true }).click();
  await page.getByLabel('Trade title', { exact: true }).fill('Original title');
  await page.getByRole('button', { name: 'Save trade', exact: true }).click();
  await expect.poll(() => tradeRequests).toBe(1);
  await page.getByLabel('Trade title', { exact: true }).fill('Newer edits during save');
  await (await nav.isVisible() ? nav.getByRole('button', { name: 'Markets', exact: true }) : page.getByRole('button', { name: 'Markets', exact: true }).first()).click();
  await open();
  await expect(page.getByLabel('Trade title', { exact: true })).toHaveValue('Newer edits during save');
  releaseTrade();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fluxdesk.journal.draft.v1')!).revision)).toBe(1);
  await expect(page.getByRole('button', { name: 'Save trade', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Trade title', { exact: true })).toHaveValue('Newer edits during save');
  await page.getByRole('button', { name: 'Save trade', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Trade editor', exact: true })).toHaveCount(0);
  expect(trades).toHaveLength(1); expect(trades[0]).toMatchObject({ id: 'delayed-trade', revision: 2, title: 'Newer edits during save' });
  await page.getByLabel('Selected journal date', { exact: true }).fill('2026-10-25');
  const plan = page.getByRole('textbox', { name: 'Daily plan / risk rules', exact: true });
  await plan.fill('Submitted daily plan');
  await page.getByRole('button', { name: 'Save daily note', exact: true }).click();
  await expect.poll(() => dayRequests).toBe(1);
  await plan.fill('Later daily plan');
  await page.getByLabel('Selected journal date', { exact: true }).fill('2026-10-26');
  await plan.fill('Different day stays'); releaseDay();
  await expect(page.getByRole('button', { name: 'Save daily note', exact: true })).toBeEnabled();
  await expect(plan).toHaveValue('Different day stays');
  await page.getByLabel('Selected journal date', { exact: true }).fill('2026-10-25');
  await expect(plan).toHaveValue('Later daily plan');
  await page.getByRole('button', { name: 'Save daily note', exact: true }).click();
  await expect.poll(() => days.find(d => d.date === '2026-10-25')?.revision).toBe(2);
  await expect(plan).toHaveValue('Later daily plan');
});
