import { test, expect } from '@playwright/test';

test('quick view exposes labeled remaining limits and opens the dashboard', async ({ page }) => {
  await page.goto('/?view=quick');
  await expect(page.getByRole('heading', { name: 'A little room to create.' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining' })).toHaveAttribute('aria-valuenow', '62');
  await expect(page.getByText('Sample data only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Your AI, in view.' })).toBeVisible();
});

test('quick view follows dashboard provider and theme changes', async ({ page, context }) => {
  await page.goto('/');
  const quick = await context.newPage();
  await quick.goto('/?view=quick');
  await expect(quick.getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('switch', { name: 'Show Cursor' }).click();
  await expect(quick.getByRole('article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'light theme', exact: true }).click();
  await expect(quick.locator('html')).toHaveAttribute('data-theme', 'light');
  await quick.close();
});
