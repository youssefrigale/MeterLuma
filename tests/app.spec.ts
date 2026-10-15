import { test, expect } from '@playwright/test';


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true }));
  });
});
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

test('personal-use license is readable and replaces the Pro offer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discover Pro', exact: true })).toHaveCount(0);
  await page.locator('.about-panel').getByRole('button', { name: 'View license', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Free for personal use.' });
  await expect(dialog).toContainText('Personal, noncommercial use only.');
  await expect(dialog).toContainText('Selling and redistribution are prohibited.');
  await dialog.getByText('Read the full license', { exact: true }).click();
  await expect(dialog.locator('.license-details').first().locator('pre')).toBeVisible();
  await expect(dialog.locator('.license-details').first().locator('pre')).toContainText('MeterLuma Personal Use License 1.1');
  expect(await dialog.locator('.license-details').first().locator('pre').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Back to my workspace' }).click();
  await expect(dialog).not.toBeVisible();
});

test('corrupted settings fall back to real-data setup safely', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v2', '{invalid json'));
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(0);
});
