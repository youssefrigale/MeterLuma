import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, nativeBridge } from './fixtures';

test.use({ viewport: { width: 360, height: 440 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });

for (const theme of ['dark', 'light']) test(`${theme} Connections fits compactly and expands account setup on demand`, async ({ page }, testInfo) => {
  await page.exposeFunction('resizeNativePanel', async (height: number) => page.setViewportSize({ width: 360, height: Math.min(1000, height) }));
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, theme, enabled: ['claude', 'codex'], liveProviders: ['claude', 'codex'], ignoredLocalProviders: ['cursor'] },
    quotas: { claude: { metrics: [{ label: 'Session', usedPercent: 24, resetIn: 3_600_000 }] }, codex: { metrics: [{ label: 'Weekly', usedPercent: 30, resetIn: 86_400_000 }] } },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect Claude', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Disconnect Codex', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Connect Cursor', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Use history only', exact: true })).toBeVisible();
  await expect(page.getByLabel('Local profile directory', { exact: true })).toBeHidden();
  await expect.poll(() => page.viewportSize()!.height).toBeLessThan(600);
  await expect(page.getByText('More providers', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: /^MeterLuma .+ options$/ })).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.quick-scroll').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  const compact = page.viewportSize()!.height;
  await page.screenshot({ path: testInfo.outputPath(`connections-${theme}-compact.png`) });
  const accounts = page.locator('.profile-accounts summary');
  await accounts.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Local profile directory', { exact: true })).toBeVisible();
  await expect.poll(() => page.viewportSize()!.height).toBeGreaterThan(compact);
  await page.getByLabel('Account label', { exact: true }).fill('Work account');
  await page.getByLabel('Local profile directory', { exact: true }).fill('/Users/example/.codex-work');
  await expect(page.getByRole('button', { name: 'Add local account', exact: true })).toBeEnabled();
  await accounts.click();
  await expect.poll(() => page.viewportSize()!.height).toBe(compact);
  await accounts.click();
  await expect(page.getByLabel('Account label', { exact: true })).toHaveValue('Work account');
  await accounts.click();
  await page.getByText('About connections', { exact: true }).click();
  await expect(page.getByText(/Uses an undocumented Cursor endpoint/, { exact: false })).toBeVisible();
  await page.getByText('About connections', { exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBe(compact);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});
