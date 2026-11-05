import { expect, test, type Page } from '@playwright/test';
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
  await expect(page.getByText('Saved to your owner account.')).toBeVisible();
  await page.getByRole('button', { name: 'Add stock', exact: true }).click();
  for (const [label, value] of Object.entries({
    'Company name': 'Example Japan Automation',
    'Stock ticker': '7203',
    'Listing exchange': 'TSE',
    'Company country': 'Japan',
    'Listing currency': 'JPY',
    'Economic theme': 'Automation',
    'Target weight (%)': '15',
    'Investment thesis': 'Private automation hypothesis',
    'TradingView reference': 'TSE:7203',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save stock', exact: true }).click();
  await expect(page.getByRole('button', { name: /Example Japan Automation/ })).toBeVisible();
  await expect(page.getByText('Private automation hypothesis', { exact: true })).toBeVisible();
  await expect(page.getByText('TSE:7203 · JPY · Japan')).toBeVisible();
  expect(await page.locator('iframe[title^="TradingView"]').count()).toBe(0);
  await page.reload();
  await expect(page.getByText('Private automation hypothesis', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive stock', exact: true }).click();
  await expect(page.getByText('No stocks match this view.')).toBeVisible();
  await page.getByLabel('Show archived stocks').check();
  await page.getByRole('button', { name: /Example Japan Automation/ }).click();
  await page.getByRole('button', { name: 'Restore archived stock', exact: true }).click();
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
  await page.getByRole('button', { name: 'Reload investments', exact: true }).click();
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
  await expect(page.getByText('Research review: 2026-10-19')).toBeVisible();
  await expect(page.getByLabel('Select investment thesis', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Import investment file').setInputFiles(file);
  await page.getByRole('button', { name: 'Import theses to owner account' }).click();
  await expect(page.getByRole('alert')).toContainText('already imported');
  await expect(page.getByLabel('Select investment thesis', { exact: true }).locator('option')).toHaveCount(2);
});
