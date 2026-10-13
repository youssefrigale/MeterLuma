import { test, expect } from '@playwright/test';

test('tray panel exposes costs, remaining limits, a fixed Options footer and dashboard access', async ({ page }) => {
  await page.goto('/?view=quick');
  await page.setViewportSize({ width: 360, height: 660 });
  await expect(page.getByRole('heading', { name: 'Cost', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining' })).toHaveAttribute('aria-valuenow', '62');
  await expect(page.getByText(/Sample data only/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Today simulated costs: $8.42' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('.quick-footer').evaluate(element => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.quick-scroll').evaluate(element => element.scrollTop = element.scrollHeight);
  await expect(page.getByRole('heading', { name: 'Cursor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Your AI, in view.' })).toBeVisible();
});

test('cost tabs recalculate samples and Options supports keyboard navigation to Settings', async ({ page }) => {
  await page.goto('/?view=quick');
  await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Yesterday simulated costs: $5.90' })).toBeVisible();
  await page.getByRole('button', { name: '30 Days', exact: true }).click();
  await expect(page.getByRole('img', { name: /30 Days simulated costs:/ })).toBeVisible();
  await expect(page.locator('.quick-cost-legend')).toContainText('$');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Refresh now' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
});

test('live tray panel shows unavailable costs without a simulated donut', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v1', JSON.stringify({ demo: false })));
  await page.goto('/?view=quick');
  await expect(page.getByText('Cost data unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose providers' }).click();
  await expect(page.getByRole('heading', { name: 'Everything, together.' })).toBeVisible();
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
