import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, history, nativeBridge } from './fixtures';

const quota = { plan: 'prolite', metrics: [{ label: 'Weekly', usedPercent: 31, resetIn: 500000 }], codexAccount: { credits: { balance: 0, hasCredits: false, unlimited: false }, availableResets: 0, includedUsageAllowed: true } };
for (const theme of ['light', 'dark']) test(`Codex ${theme} shows plan, credits and reset count without invented charges`, async ({ page }, info) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, theme, liveProviders: ['codex'] }, quotas: { codex: quota }, histories: { codex: history() } });
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Pro 5x');
  await expect(page.getByRole('progressbar', { name: 'Codex Weekly remaining' })).toHaveAttribute('aria-valuenow', '69');
  const section = page.getByRole('region', { name: 'Codex subscription details', exact: true });
  await expect(section).toContainText('0 available');
  await expect(section).toContainText('0 credits');
  await expect(section.locator('dd').first()).toHaveText('Available');
  await expect(section).not.toContainText('$');
  await expect(page.locator('.usage-history')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`codex-${theme}.png`) });
  await section.locator('summary').click();
  await expect(section).toContainText('Local Codex sign-in');
  await expect(section).toContainText('Billing charges and renewal dates are not provided.');
  expect(await section.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('missing account fields stay unavailable instead of becoming zero or active', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'] }, quotas: { codex: { plan: 'plus', metrics: quota.metrics } }, histories: { codex: history() } });
  await page.goto('/'); await page.getByRole('button', { name: 'Codex details' }).click();
  await page.locator('.quick-subscription summary').click();
  const rows = page.locator('.quick-subscription details dl').first().locator('dd');
  await expect(rows).toHaveText(['Unavailable', 'Unavailable', 'Unavailable']);
  await expect(page.locator('.quick-plan')).toHaveText('Plus');
});

test('cached subscription details keep their cached label and preserve blocked usage and unlimited credits', async ({ page }) => {
  const snapshot = { ...quota, codexAccount: { credits: { balance: null, hasCredits: true, unlimited: true }, availableResets: 2, includedUsageAllowed: false } };
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'] }, quotas: { codex: { error: { code: 'unavailable', message: 'Offline' }, snapshot } }, histories: { codex: history() } });
  await page.goto('/'); await page.getByRole('button', { name: 'Codex details' }).click();
  const section = page.getByRole('region', { name: 'Cached Codex subscription details' });
  await expect(section.locator(':scope > dl dd')).toHaveText(['Not available', '2 available', 'Unlimited']);
  await expect(section.locator('summary')).toHaveText('Cached subscription details');
  await section.locator('summary').click();
  await expect(section).toContainText('Cached at');
});
