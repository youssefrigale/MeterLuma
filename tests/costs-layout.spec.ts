import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, history, nativeBridge, nativeCalls } from './fixtures';

for (const theme of ['dark', 'light']) test(`${theme} zero-value Costs has a readable total and aligned provider row`, async ({ page }, testInfo) => {
  const recorded = history({ cost: .25 });
  recorded.days[recorded.days.length - 1].estimatedCostUsd = 0;
  await nativeBridge(page, { settings: { legalVersion: LEGAL, theme, liveProviders: ['claude'] }, histories: { claude: recorded } });
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.locator('.quick-cost-amount')).toHaveText('$0.00');
  await expect(page.getByText('No priced usage in this period.')).toBeVisible();
  const amount = await page.locator('.quick-cost-amount').boundingBox();
  const row = await page.locator('.quick-cost-legend li').boundingBox();
  expect(amount!.y + amount!.height).toBeLessThan(row!.y);
  expect(await page.locator('.quick-cost').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`costs-zero-${theme}.png`) });
});

test('large costs and long account labels do not overlap at the narrow panel width', async ({ page }, testInfo) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, theme: 'dark', profiles: [{ key: 'work', providerId: 'claude', label: 'Personal account with a deliberately long label', directory: 'C:/fixture/history' }] }, histories: { claude: history({ cost: 123456.78 }) } });
  await page.setViewportSize({ width: 320, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.locator('.quick-cost-amount')).toHaveText('$123,456.78');
  const label = await page.locator('.quick-cost-legend li > span').boundingBox();
  const amount = await page.locator('.quick-cost-legend strong').boundingBox();
  expect(label!.x + label!.width).toBeLessThanOrEqual(amount!.x - 5);
  expect(await page.locator('.quick-cost').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('costs-large.png') });
});

test('navigation keeps the panel and footer fixed and never requests a different native size', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['claude'] }, histories: { claude: history({ cost: .2 }) } });
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  const panel = await page.locator('.quick-view').boundingBox();
  const footer = await page.locator('.quick-footer').boundingBox();
  const initial = (await nativeCalls(page)).filter(call => call.command === 'resize_quick');
  expect(initial.length).toBeGreaterThan(0);
  for (const name of ['Claude details', 'Costs', 'Help', 'Connections', 'Settings', 'Overview']) {
    await page.getByRole('button', { name, exact: true }).click();
    expect(await page.locator('.quick-view').boundingBox()).toEqual(panel);
    expect(await page.locator('.quick-footer').boundingBox()).toEqual(footer);
  }
  expect((await nativeCalls(page)).filter(call => call.command === 'resize_quick')).toEqual(initial);
});
