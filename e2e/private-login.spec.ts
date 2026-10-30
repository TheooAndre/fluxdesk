import { test, expect } from '@playwright/test';
test('login gates API queries, supports retry and logout on desktop/mobile', async ({ page }) => {
  let authenticated = false,
    markets = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { authenticated, loginRequired: true } });
    if (path === '/api/auth/login') {
      authenticated = route.request().postDataJSON().password === 'test-only-ui-password';
      return route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated ? { authenticated } : { error: 'Incorrect password.' },
      });
    }
    if (path === '/api/auth/logout') {
      authenticated = false;
      return route.fulfill({ json: { authenticated } });
    }
    if (path === '/api/markets') {
      markets++;
      return route.fulfill({
        json: { assets: [], benchmarks: {}, feeds: [], asOf: Date.now(), checkedAt: Date.now() },
      });
    }
    return route.fulfill({ json: { ids: [], rules: [], events: [] } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Private workspace' })).toBeVisible();
  expect(markets).toBe(0);
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect password.');
  expect(markets).toBe(0);
  await page.getByLabel('Password', { exact: true }).fill('test-only-ui-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect.poll(() => markets).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private workspace' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.screenshot({ path: 'test-results/login-screen-' + test.info().project.name + '.png' });
});
test('session verification fails closed when offline', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Private workspace' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Cannot verify your session');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});
