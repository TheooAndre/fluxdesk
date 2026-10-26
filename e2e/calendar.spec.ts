import { test, expect } from '@playwright/test';

test('free macro feed shows official source and provider credit', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { message: 'Other feeds unavailable' } }));
  await page.route('**/api/calendar', route => route.fulfill({ json: {
    configured: true, events: [{ id: 'cpi', time: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      country: 'US', title: 'US CPI', importance: 3, forecast: '', previous: '', actual: '',
      status: 'estimated', stale: false, sourceName: 'Bureau of Labor Statistics',
      sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm' }],
  } }));
  await page.goto('/');
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await (await mobileNav.isVisible() ? mobileNav.getByRole('button', { name: 'Macro' }) :
    page.getByRole('button', { name: 'Macro calendar' })).click();
  await expect(page.getByText('US CPI', { exact: true })).toBeVisible();
  await expect(page.getByText('US · Estimated date')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bureau of Labor Statistics' }))
    .toHaveAttribute('href', 'https://www.bls.gov/schedule/news_release/cpi.htm');
  await expect(page.getByRole('link', { name: 'Finance Calendar' }))
    .toHaveAttribute('href', 'https://www.financecalendar.com');
  await page.route('**/api/calendar', route => route.fulfill({ status: 503, json: { error: 'Calendar temporarily unavailable' } }));
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByText('Refresh failed. Showing the last loaded calendar; dates may have changed.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('US CPI', { exact: true })).toBeVisible();
  await page.route('**/api/calendar', route => route.fulfill({ json: { configured: true, events: [] } }));
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByText('No timed, high-impact US releases available in this window.')).toBeVisible();
  await expect(page.getByText('US CPI', { exact: true })).toHaveCount(0);
});
