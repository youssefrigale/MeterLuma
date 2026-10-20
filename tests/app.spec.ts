import { test, expect } from '@playwright/test';


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true }));
  });
});
test('the app is the tray panel: no dashboard pages, and old dashboard links open the panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const url of ['/', '/?page=dashboard', '/?page=connections']) {
    await page.goto(url);
    await expect(page.getByRole('main', { name: 'MeterLuma usage panel' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your AI, in view.' })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open dashboard' })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('theme and provider visibility persist after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Cursor', exact: true }).uncheck();
  await page.getByRole('button', { name: 'light theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('progressbar', { name: 'Codex Session remaining' })).toHaveAttribute('aria-valuenow', '78');
  // Claude is a local-history provider, even in the sample preview.
  await expect(page.getByRole('article').filter({ hasText: 'Claude' }).getByRole('progressbar')).toHaveCount(0);
});

test('live mode never presents sample data as connected accounts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Use sample data' }).uncheck();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Keep your allowances in view.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose providers' }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  // The browser preview cannot read local profiles, so connecting offers the labeled samples instead.
  await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await page.getByRole('dialog', { name: 'Connect in the desktop app.' }).getByRole('button', { name: 'Explore sample data' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
});

test('personal-use license is readable from Help', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discover Pro', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View license', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Free for personal use.' });
  await expect(dialog).toContainText('Personal, noncommercial use only.');
  await expect(dialog).toContainText('Selling and redistribution are prohibited.');
  await dialog.getByText('Read the full license', { exact: true }).click();
  await expect(dialog.locator('.license-details').first().locator('pre')).toBeVisible();
  await expect(dialog.locator('.license-details').first().locator('pre')).toContainText('MeterLuma Personal Use License 1.1');
  expect(await dialog.locator('.license-details').first().locator('pre').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).not.toBeVisible();
});

test('corrupted settings fall back to real-data setup safely', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v2', '{invalid json'));
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Keep your allowances in view.')).toBeVisible();
});
