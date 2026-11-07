import { test, expect } from '@playwright/test';
import { LEGAL, history, nativeBridge, nativeCalls } from './fixtures';

test.use({ viewport: { width: 360, height: 440 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });

for (const theme of ['dark', 'light']) test(`${theme} compact Mac panel keeps navigation and footer reachable`, async ({ page }, testInfo) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, theme, liveProviders: ['claude', 'codex', 'cursor'] },
    quotas: {
      codex: { plan: 'prolite', metrics: [{ label: 'Weekly', usedPercent: 12, resetIn: 6 * 86400000 }], codexAccount: { includedUsageAllowed: true, availableResets: 0, credits: { balance: 0, hasCredits: false, unlimited: false } } },
      cursor: { metrics: [{ label: 'Monthly', usedPercent: 35, resetIn: 12 * 86400000 }] },
    },
    histories: { claude: history(), codex: history({ tokens: 80000000, models: [{ name: 'model-alpha', share: .57 }, { name: 'model-beta', share: .33 }, { name: 'model-gamma', share: .1 }] }) },
  });
  await page.goto('/');
  await expect(page.getByRole('progressbar', { name: 'Codex Weekly remaining' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`mac-overview-${theme}.png`) });
  const footer = await page.locator('.quick-footer').boundingBox();
  for (const name of ['Codex details', 'Claude details', 'Cursor details', 'Costs', 'Connections', 'Help', 'Settings', 'Overview']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport();
    await page.getByRole('button', { name, exact: true }).click();
    expect(await page.locator('.quick-footer').boundingBox()).toEqual(footer);
    await expect(page.getByRole('button', { name: /^MeterLuma .+ options$/ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (name === 'Codex details') {
      await expect(page.locator('.quick-plan')).toHaveText('Pro 5x');
      await expect(page.getByText('model-gamma')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath(`mac-codex-${theme}.png`) });
      await page.locator('.quick-models').scrollIntoViewIfNeeded();
      await expect(page.getByText('model-gamma')).toBeInViewport();
    }
    if (name === 'Settings') {
      await page.getByRole('button', { name: 'Manage connections', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Manage connections', exact: true })).toBeInViewport();
    }
  }
});

test('compact Mac consent dialog can scroll to its agreement controls', async ({ page }) => {
  await nativeBridge(page, { settings: { theme: 'dark' } });
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(440);
  await page.getByText('Read the full license', { exact: true }).click();
  await page.getByRole('checkbox').scrollIntoViewIfNeeded();
  await expect(page.getByRole('checkbox')).toBeInViewport();
  await page.getByRole('button', { name: 'Quit', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Quit', exact: true })).toBeInViewport();
});

test('Mac menu-bar usage follows the selected provider and prefers its session window', async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex', 'cursor'] },
    histories: { codex: history() },
    quotas: {
      codex: { metrics: [{ label: 'Weekly', usedPercent: 65, resetIn: 86_400_000 }, { label: 'Session', usedPercent: 27, resetIn: 3_600_000 }] },
      cursor: { metrics: [{ label: 'Monthly', usedPercent: 40, resetIn: 86_400_000 }] },
    },
  });
  await page.goto('/');
  const menuStatus = async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status;
  await expect.poll(menuStatus).toEqual({ provider: 'codex', remaining: 73, cached: false, demo: false, warning: false });
  expect((await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.summary).toContain('Codex Session 73% left');
  await page.getByRole('button', { name: 'Cursor details', exact: true }).click();
  await expect.poll(menuStatus).toEqual({ provider: 'cursor', remaining: 60, cached: false, demo: false, warning: false });
  await page.getByRole('button', { name: 'Codex details', exact: true }).click();
  await expect.poll(menuStatus).toEqual({ provider: 'codex', remaining: 73, cached: false, demo: false, warning: false });
});

for (const expired of [false, true]) test(`Mac menu-bar ${expired ? 'clears expired' : 'labels cached'} quota usage`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex'] },
    quotas: { codex: { error: { code: 'rate_limited', message: 'Please retry later.' }, retryIn: 3_600_000, snapshot: { ageMs: 120_000, metrics: [{ label: 'Weekly', usedPercent: 100, resetIn: expired ? -60_000 : 86_400_000 }] } } },
  });
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: 'Codex' })).toContainText(expired ? 'Live allowances unavailable' : 'Cached quotas');
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status)
    .toEqual(expired ? null : { provider: 'codex', remaining: 0, cached: true, demo: false, warning: true });
});

test('Mac menu-bar omits a percentage for local history without subscription quotas', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['claude'] }, histories: { claude: history() } });
  await page.goto('/');
  await expect(page.getByText(/Local history only · .* tokens today/)).toBeVisible();
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status).toBeNull();
});
