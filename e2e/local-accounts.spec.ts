import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.VITE_FLUXDESK_PUBLIC_MODE !== 'true', 'Run with VITE_FLUXDESK_PUBLIC_MODE=true');
const PASSWORD = 'Browser test passphrase only 2026!';
const CODE = 'a'.repeat(32);
async function mockAccounts(page: Page, setup = false) {
  let signedIn = false;
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unrelated mock feed unavailable' } }),
  );
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: signedIn,
        accountId: signedIn ? 'account:test-browser-user' : null,
        provider: signedIn ? 'password' : null,
        name: signedIn ? 'Test User' : null,
        owner: setup && signedIn,
        providers: { discord: false, x: false, password: true },
        registrationOpen: !setup || signedIn,
        ownerSetupAllowed: setup && !signedIn,
        recoveryAvailable: true,
      },
    }),
  );
  await page.route('**/api/auth/register*', (route) => {
    signedIn = true;
    return route.fulfill({ json: { success: true, recoveryCode: CODE } });
  });
}

test('registration validates confirmation and requires saving the recovery code before continuing', async ({
  page,
}) => {
  await mockAccounts(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in / Register', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await dialog.getByLabel('Display name', { exact: true }).fill('Test User');
  await dialog.getByLabel('Email', { exact: true }).fill('browser@example.test');
  await dialog.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password', { exact: true }).fill('Different test passphrase!');
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The passwords do not match.');
  await dialog.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  await expect(dialog.getByText(CODE, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'I saved my recovery code' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
});

test('protected owner setup explains legacy ownership and uses its dedicated registration endpoint', async ({
  page,
}) => {
  await mockAccounts(page, true);
  let usedOwnerEndpoint = false;
  await page.route('**/api/auth/register-owner', (route) => {
    usedOwnerEndpoint = true;
    return route.fulfill({ json: { success: true, recoveryCode: CODE } });
  });
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Create your owner account' })).toBeVisible();
  await dialog.getByLabel('Display name', { exact: true }).fill('Owner');
  await dialog.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await dialog.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create owner account', exact: true }).click();
  await expect(
    dialog.getByText('Your existing journal and alerts are now attached to this owner account.'),
  ).toBeVisible();
  expect(usedOwnerEndpoint).toBe(true);
});

test('recovery reports invalid codes and shows a replacement code after a successful reset', async ({
  page,
}) => {
  await mockAccounts(page);
  await page.route('**/api/auth/recover', (route) => {
    const body = route.request().postDataJSON() as { recoveryCode: string };
    return body.recoveryCode === CODE
      ? route.fulfill({ json: { success: true, recoveryCode: 'b'.repeat(32) } })
      : route.fulfill({
          status: 400,
          json: { error: 'Recovery failed. Check your email, recovery code and new password.' },
        });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in / Register', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Forgot password? Use your recovery code' }).click();
  await dialog.getByLabel('Email', { exact: true }).fill('browser@example.test');
  await dialog.getByLabel('Recovery code', { exact: true }).fill('c'.repeat(32));
  await dialog.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Recovery failed.');
  await dialog.getByLabel('Recovery code', { exact: true }).fill(CODE);
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog.getByText('b'.repeat(32), { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('Your password has been reset. Sign in with the new password after saving this code.'),
  ).toBeVisible();
});
