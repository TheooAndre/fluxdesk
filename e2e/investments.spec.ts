import { expect, test, type Page } from '@playwright/test';
import { stockDataFixture } from '../tests/fixtures/stock-data.ts';
import { investmentFixture } from '../tests/fixtures/investments.ts';
import type { Investments } from '../src/investments/model.ts';

async function mocks(page: Page, owner = true, initial?: Investments) {
  let data = initial ?? ({ schemaVersion: 1, revision: 0, portfolios: [] } as Investments);
  let conflict = false;
  const investmentRequests: string[] = [];
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Other mock feed unavailable' } }),
  );
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        owner,
        accountId: owner ? 'account:synthetic-owner' : 'account:synthetic-friend',
        name: 'Owner',
        provider: 'password',
        providers: { password: true, discord: false, x: false },
      },
    }),
  );
  await page.route('**/api/investments', async (route) => {
    investmentRequests.push(route.request().method());
    if (!owner) return route.fulfill({ status: 403, json: { error: 'Owner access required' } });
    if (route.request().method() === 'POST') {
      if (conflict)
        return route.fulfill({
          status: 409,
          json: { error: 'Investments changed on another device. Reload before saving.' },
        });
      data = { ...(route.request().postDataJSON() as Investments), revision: data.revision + 1 };
    }
    return route.fulfill({ json: data });
  });
  await page.route('**/api/investments/search?**', route => route.fulfill({json: { matches: [{ symbol: '7203.T', name: 'Example Japan Automation', exchange: 'Tokyo', type: 'EQUITY', sector: 'Automation' }] }}));
  await page.route('**/api/investments/stock?**', route => route.fulfill({json: stockDataFixture(new URL(route.request().url()).searchParams.get('symbol') ?? '7203.T')}));
  return {
    requests: investmentRequests,
    setConflict: (next: boolean) => {
      conflict = next;
    },
  };
}
async function openInvestments(page: Page) {
  const mobile = page.getByRole('navigation', { name: 'Mobile navigation' });
  const button = (await mobile.isVisible())
    ? mobile.getByRole('button', { name: 'Invest', exact: true })
    : page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: 'Investments', exact: true });
  await button.click();
}

test('owner creates a global thesis and Japanese stock, persists notes, and archives/restores without losing research', async ({
  page,
}) => {
  await mocks(page);
  await page.goto('/');
  await openInvestments(page);
  await page.getByRole('button', { name: 'New thesis', exact: true }).click();
  await page.getByLabel('Thesis name', { exact: true }).fill('Global power infrastructure');
  await page.getByLabel('Time horizon', { exact: true }).fill('5 years');
  await page.getByRole('button', { name: 'Save thesis', exact: true }).click();
  await expect(page.getByText('Saved.', {exact: true})).toBeVisible();
  await page.getByRole('button', { name: 'Add stock', exact: true }).click();
  await page.getByLabel('Find a stock or ETF').fill('Toyota');
  await page.getByRole('button', {name: /7203.T.*Example Japan Automation/}).click();
  await expect(page.getByLabel('Stock ticker', {exact: true})).toHaveValue('7203.T');
  await expect(page.getByLabel('Listing currency', {exact: true})).toHaveValue('JPY');
  await page.getByLabel('Target weight (%)', {exact: true}).fill('15');
  await page.getByLabel('Investment thesis', {exact: true}).fill('Private automation hypothesis');
  await page.getByRole('button', { name: 'Save stock', exact: true }).click();
  await expect(page.getByRole('button', { name: /Example Japan Automation/ })).toBeVisible();
  await expect(page.getByText('Private automation hypothesis', { exact: true })).toBeVisible();
  await expect(page.getByText('Tokyo:7203.T · JPY · Japan')).toBeVisible();
  await expect(page.getByText('3,000', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'News',exact:true}).click();
  await expect(page.getByRole('link', {name:/Example Japan Automation opens a new factory/})).toBeVisible();
  await page.getByRole('button', {name:'Company',exact:true}).click();
  await expect(page.getByText('Synthetic issuer profile for UI testing.')).toBeVisible();
  await page.getByRole('button', {name:'Overview',exact:true}).click();
  await expect(page.getByRole('img', {name:/7203.T six-month daily closing prices in JPY/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: test.info().outputPath('investments-desktop-mobile.png'), fullPage:true});
  expect(await page.locator('iframe[title^="TradingView"]').count()).toBe(0);
  await page.reload();
  await expect(page.getByText('Private automation hypothesis', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive stock', exact: true }).click();
  await expect(page.getByText('No stocks match this view.')).toBeVisible();
  await page.getByLabel('Show archived stocks').check();
  await page.getByRole('button', { name: /Example Japan Automation/ }).click();
  await page.getByRole('button', { name: 'Restore stock', exact: true }).click();
  await page.getByLabel('Show archived stocks').uncheck();
  await expect(page.getByRole('button', { name: /Example Japan Automation/ })).toBeVisible();
});

test('failed concurrent save keeps the owner draft and reload does not erase it', async ({ page }) => {
  const controls = await mocks(page, true, investmentFixture());
  await page.goto('/');
  await openInvestments(page);
  await page.getByRole('button', { name: 'Edit stock', exact: true }).click();
  await page.getByLabel('Investment thesis', { exact: true }).fill('Unsaved revised economic thesis');
  controls.setConflict(true);
  await page.getByRole('button', { name: 'Save stock', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed on another device');
  await expect(page.getByLabel('Investment thesis', { exact: true })).toHaveValue(
    'Unsaved revised economic thesis',
  );
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByLabel('Investment thesis', { exact: true })).toHaveValue(
    'Unsaved revised economic thesis',
  );
  controls.setConflict(false);
  await page.getByRole('button', { name: 'Save stock', exact: true }).click();
  await expect(page.getByText('Unsaved revised economic thesis', { exact: true })).toBeVisible();
});

test('friend with the owner display name never sees the tab or requests private investments', async ({
  page,
}) => {
  test.skip(process.env.VITE_FLUXDESK_PUBLIC_MODE !== 'true', 'Public-account build required');
  const controls = await mocks(page, false);
  await page.goto('/?tab=investments');
  await expect(page.getByText('This tool is available to the owner.')).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Investments', exact: true }),
  ).toHaveCount(0);
  expect(controls.requests).toEqual([]);
  await expect(page.getByText('Synthetic private memo')).toHaveCount(0);
});

test('legacy MCGA import preserves existing global theses and rejects duplicate imports', async ({
  page,
}) => {
  await mocks(page, true, investmentFixture());
  await page.goto('/');
  await openInvestments(page);
  const row = {
    name: 'Synthetic China Manufacturer',
    symbol: 'SYN',
    market: 'Gettex',
    weight: 4,
    theme: 'Equipment',
    tv: 'HKEX:1234',
    status: 'Hold',
    thesis: 'Synthetic historical memo',
    trigger: 'Demand',
    fail: 'Cash burn',
    risks: 'Execution',
    link: 'https://example.com/SYN',
  };
  const file = {
    name: 'synthetic-mcga.html',
    mimeType: 'text/html',
    buffer: Buffer.from(`const STOCKS=${JSON.stringify([row])};`),
  };
  await page.getByLabel('Import investment file').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Review investment import' })).toBeVisible();
  await page.getByRole('button', { name: 'Import theses to owner account' }).click();
  await page.getByLabel('Select investment thesis', { exact: true }).selectOption('mcga-v2-20261019');
  await expect(page.getByText('Synthetic historical memo', { exact: true })).toBeVisible();
  await expect(page.getByText('Reviewed: 2026-10-19')).toBeVisible();
  await expect(page.getByLabel('Select investment thesis', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Import investment file').setInputFiles(file);
  await page.getByRole('button', { name: 'Import theses to owner account' }).click();
  await expect(page.getByRole('alert')).toContainText('already imported');
  await expect(page.getByLabel('Select investment thesis', { exact: true }).locator('option')).toHaveCount(2);
});

 test('failed ticker lookup preserves the memo and reports unavailable data without inventing a match', async ({ page }) => {
  await mocks(page, true, investmentFixture());
  await page.route('**/api/investments/search?**', route => route.fulfill({status:502,json:{error:'Yahoo Finance unavailable (HTTP 429)'}}));
  await page.goto('/'); await openInvestments(page);
  await page.getByRole('button', {name:'Link listing',exact:true}).click();
  await page.getByLabel('Find a stock or ETF').fill('Example');
  await expect(page.getByRole('alert')).toContainText('Yahoo Finance unavailable');
  await expect(page.getByLabel('Investment thesis',{exact:true})).toHaveValue('Synthetic private memo');
 });
