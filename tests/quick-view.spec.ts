import { test, expect } from '@playwright/test';


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true }));
  });
});
test('tray panel exposes costs, remaining limits, a fixed Options footer and Connections', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 660 });
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('progressbar', { name: 'Codex Session remaining' })).toHaveAttribute('aria-valuenow', '78');
  await expect(page.locator('.quick-provider').filter({ hasText: 'Claude' })).toContainText('Local history only');
  await expect(page.getByText(/Sample data only/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sample spend today $8.42' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('.quick-footer').evaluate(element => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.quick-scroll').evaluate(element => element.scrollTop = element.scrollHeight);
  await expect(page.getByRole('heading', { name: 'Cursor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open dashboard' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(page.locator('.quick-connection')).toHaveCount(3);
});

test('cost tabs recalculate samples and Options supports keyboard navigation to Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '5 min', exact: true })).toBeVisible();
});

test('live tray panel shows unavailable costs without a simulated donut', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: false })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.getByText('No estimated API value yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Choose providers' }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
});

test('provider sidebar isolates details and settings change bars, timers, order and visibility persistently', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Claude', exact: true })).toBeVisible();
  await expect(page.locator('.quick-statistics')).toContainText('$4.26');
  await expect(page.getByRole('img', { name: 'Claude simulated spending over 14 days' })).toBeVisible();
  await expect(page.locator('.quick-models')).toContainText('Illustrative');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Used', exact: true }).click();
  await page.getByRole('button', { name: 'Absolute', exact: true }).click();
  await page.getByRole('button', { name: '24-hour', exact: true }).click();
  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await page.getByRole('button', { name: 'Move Codex up' }).click();
  await page.getByRole('checkbox', { name: 'Cursor', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').first()).toContainText('Codex');
  await expect(page.getByRole('progressbar', { name: 'Codex Session used' })).toHaveAttribute('aria-valuenow', '22');
  await expect(page.locator('.quick-metric-caption').first()).not.toContainText('Resets in');
  await expect(page.getByRole('button', { name: 'Cursor details' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article').first()).toContainText('Codex');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: '30 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Used', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('disabled selected provider returns to overview and live details never include sample spending or models', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cursor details' }).click();
  // Settings saved elsewhere (another copy of the panel here) reach the open panel.
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
  await other.getByRole('checkbox', { name: 'Cursor', exact: true }).uncheck();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Use sample data' }).uncheck();
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.getByText('This provider is not connected.')).toBeVisible();
  await expect(page.locator('.quick-statistics, .quick-models, .quick-sparkbars')).toHaveCount(0);
});
