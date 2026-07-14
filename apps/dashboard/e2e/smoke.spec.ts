import { expect, test } from '@playwright/test';

// Primary-flow smoke tests (§10.9). Backend-free: they assert the shell, routing, auth-gating, and
// error pages render and behave — the flows a broken deploy would take down first.

test('homepage renders the feed shell and primary nav', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Kvorum/);
  await expect(page.getByRole('heading', { name: 'Active proposals' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Proposals', exact: true })).toBeVisible();
});

test('top-nav navigates to the proposals list and DAO pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Proposals', exact: true }).click();
  await expect(page).toHaveURL(/\/proposals$/);

  await page.getByRole('button', { name: /DAOs/ }).click();
  await page.getByRole('menuitem', { name: 'Lido' }).click();
  await expect(page).toHaveURL(/\/daos\/lido$/);
});

test('proposal detail resolves without a 500 (graceful shell on a down backend)', async ({
  page,
}) => {
  const response = await page.goto('/daos/lido/proposals/aragon_voting/1');
  expect(response?.status()).toBe(200);
  // Either the real detail or the graceful "temporarily unavailable" shell — never a crash.
  await expect(page.locator('main')).toBeVisible();
});

test('auth pages: SIWE panel with the email toggle', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByText(/Email accounts are coming soon/)).toBeVisible();
  await page.getByRole('button', { name: /Sign in with your wallet instead/ }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();

  await page.goto('/signup');
  await expect(page.getByRole('button', { name: 'Connect wallet to sign up' })).toBeVisible();
});

test('protected /developer redirects unauthenticated users to login with a return URL', async ({
  page,
}) => {
  await page.goto('/developer');
  await expect(page).toHaveURL(/\/login\?next=%2Fdeveloper$/);
});

test('forgot/reset password render the coming-soon state', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page.getByText(/Email accounts are coming soon/)).toBeVisible();
});

test('404 pages: generic and context-aware', async ({ page }) => {
  const generic = await page.goto('/totally-unmatched-route');
  expect(generic?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  const actor = await page.goto('/actors/0x0000000000000000000000000000000000000000');
  expect(actor?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'No activity recorded' })).toBeVisible();
});
