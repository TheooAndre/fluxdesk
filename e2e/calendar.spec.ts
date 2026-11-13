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
  await expect(page.getByRole('link', { name: 'Bureau of Labor Statistics', exact: true }))
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
  await page.route('**/api/calendar', route => route.fulfill({ json: {
    configured: true, source: 'bls', staleSources: ['financecalendar'],
    message: 'Finance Calendar unavailable. Showing a partial official BLS release schedule.',
    events: [{ id: 'bls:cpi', time: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      country: 'US', title: 'Consumer Price Index', importance: 3, forecast: '', previous: '', actual: '',
      sourceName: 'U.S. Bureau of Labor Statistics', sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics' }],
  } }));
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByText('Consumer Price Index', { exact: true })).toBeVisible();
  await expect(page.getByText('Source: official BLS schedule · partial coverage')).toBeVisible();
  await expect(page.getByText('Unavailable source: financecalendar')).toBeVisible();
  await page.route('**/api/calendar', route => route.fulfill({ json: {
    configured: true, source: 'bea', staleSources: ['bls', 'xoomar'],
    message: 'Showing a partial official BEA release schedule.',
    sources: [
      { id: 'financecalendar', name: 'Finance Calendar', status: 'not_configured', checkedAt: Date.now() },
      { id: 'bls', name: 'BLS', status: 'unavailable', checkedAt: Date.now(), message: 'HTTP 403' },
      { id: 'bea', name: 'BEA', status: 'live', checkedAt: Date.now(), eventCount: 0 },
    ],
    events: [],
  } }));
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByText('Source: official BEA schedule · partial coverage')).toBeVisible();
  await page.getByText('Sources', {exact:true}).click();
  const availability = page.getByRole('list', { name: 'Calendar source availability' });
  await expect(availability.getByText('BEA: available · 0 upcoming releases')).toBeVisible();
  await expect(availability.getByText('Finance Calendar: optional source not enabled')).toBeVisible();
  await expect(availability.getByText('BLS: unavailable · HTTP 403')).toBeVisible();
  await expect(page.getByText('No timed, high-impact US releases available in this window.')).toBeVisible();
});
