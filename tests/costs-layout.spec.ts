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

test('Cost includes Codex token usage without inventing a dollar estimate or adding it to the priced total', async ({ page }, testInfo) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, theme: 'dark', liveProviders: ['claude', 'codex'] },
    quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 31, resetIn: 86_400_000 }] } },
    histories: { claude: history({ cost: .25 }), codex: history({ tokens: 75000 }) },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  const codex = page.locator('.quick-cost-legend li').filter({ hasText: 'Codex' });
  for (const [range, total, tokens] of [['Today', '$0.25', '75K'], ['Yesterday', '$0.25', '75K'], ['30 Days', '$7.50', '2.3M']]) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await expect(codex).toContainText('Not priced');
    await expect(codex).toContainText(`${tokens} recorded tokens`);
    await expect(page.locator('.quick-cost-amount')).toHaveText(total);
  }
  await expect(page.getByText('Total includes priced providers only.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('costs-with-unpriced-codex.png') });
});

test('priced Codex history contributes to the combined Cost total in every range', async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['claude', 'codex'] },
    quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 31, resetIn: 86_400_000 }] } },
    histories: { claude: history({ cost: .25 }), codex: history({ tokens: 210000, cost: .31, unpriced: 10, models: [{ name: 'gpt-6.1-sol', share: 1 }] }) },
  });
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  const codex = page.locator('.quick-cost-legend li').filter({ hasText: 'Codex' });
  for (const [range, subtotal, total, excluded] of [['Today', '$0.31', '$0.56', '10'], ['Yesterday', '$0.31', '$0.56', '10'], ['30 Days', '$9.30', '$16.80', '300']]) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await expect(codex.locator('strong')).toHaveText(subtotal);
    await expect(page.locator('.quick-cost-amount')).toHaveText(total);
    await expect(page.getByText(`Excludes ${excluded} tokens from models without a known price.`)).toBeVisible();
    await expect(codex).not.toContainText('Not priced');
  }
});

for (const recorded of [false, true]) test(`Codex stays visible in Cost ${recorded ? 'with unpriced history' : 'when usage lookup fails'}`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'] },
    quotas: { codex: recorded ? { metrics: [{ label: 'Weekly', usedPercent: 31, resetIn: 86_400_000 }] } : { error: 'Sign in again to read usage.' } },
    histories: recorded ? { codex: history({ tokens: 75000 }) } : {},
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  const row = page.locator('.quick-cost-legend li').filter({ hasText: 'Codex' });
  await expect(row).toContainText(recorded ? 'Not priced' : 'Unavailable');
  await expect(page.locator('.quick-cost-amount')).toHaveCount(0);
  await expect(row).not.toContainText('$0.00');
});

for (const scenario of [
  { held: 'refresh_provider', recorded: true },
  { held: 'refresh_provider', recorded: false },
  { held: 'read_usage_history', recorded: true },
]) test(`Codex Cost settles history independently of ${scenario.held} (${scenario.recorded ? 'recorded' : 'failed'} history)`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'] },
    quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 31, resetIn: 86_400_000 }] } },
    histories: scenario.recorded ? { codex: history({ tokens: 75000 }) } : {},
  });
  await page.addInitScript(held => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.assign(window, { releaseLookup: release });
    bridge.invoke = async (command, args) => { if (command === held) await gate; return invoke(command, args); };
  }, scenario.held);
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  const row = page.locator('.quick-cost-legend li').filter({ hasText: 'Codex' });
  if (scenario.held === 'read_usage_history') await expect(row).toContainText('Reading…');
  else {
    await expect(row).toContainText(scenario.recorded ? '75K recorded tokens' : 'Recorded local history could not be read.');
    await expect(row).toContainText(scenario.recorded ? 'Not priced' : 'Unavailable');
    await expect(row).not.toContainText('Reading');
  }
  await page.evaluate(() => (window as unknown as { releaseLookup: () => void }).releaseLookup());
  await expect(row).toContainText(scenario.recorded ? 'Not priced' : 'Unavailable');
  await expect(row).not.toContainText('Reading');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
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

test.describe('Windows panel', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36' });

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

});
