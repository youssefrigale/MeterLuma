import { test, expect } from '@playwright/test';

test('dashboard labels sample data and opens provider details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your AI, in view.' })).toBeVisible();
  await expect(page.getByText('Demo preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'View Claude details' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sample account');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('provider visibility and preferences persist after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('switch', { name: 'Show Cursor' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'light theme' }).click();
  await expect(page.getByRole('switch', { name: 'Show remaining allowance' })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining' })).toHaveAttribute('aria-valuenow', '62');
});

test('live mode never presents sample data as connected accounts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('switch', { name: 'Demo preview' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Setup mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('activity range reflects the selected time window', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await expect(page.getByText('Last 7 days · sample')).toBeVisible();
  await expect(page.locator('.bar-column')).toHaveCount(7);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Demo preview' }).click();
  await page.getByRole('switch', { name: 'Demo preview' }).click();
});

test('Pro clearly describes a planned one-time purchase', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.about-panel').getByRole('button', { name: 'Discover Pro', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'A clearer picture with Pro.' });
  await expect(dialog).toContainText('one-time purchase');
  await expect(dialog).toContainText('not available in this prototype');
  await dialog.getByRole('button', { name: 'Back to my workspace' }).click();
  await expect(dialog).not.toBeVisible();
});

test('corrupted settings cannot break startup', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v1', '{invalid json'));
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(3);
});
