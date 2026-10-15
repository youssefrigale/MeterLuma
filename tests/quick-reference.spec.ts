import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function referenceBridge(page: Page, theme: string, expired = false) {
  await page.addInitScript(({ theme, expired }) => {
    localStorage.setItem('meterluma.settings.v2', JSON.stringify({ theme, legalVersion: '1.1-providers-3', demo: false, enabled: ['claude'], liveProviders: ['claude'] }));
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string) => {
      if (command === 'refresh_provider') {
        if (expired) throw 'Your sign-in has expired. Sign in again using the provider app.';
        return { id: 'claude', name: 'Claude', plan: 'Team', color: '#d97757', initials: '', spendToday: null, fetchedAt: Date.now(), metrics: [
          { label: 'Session', usedPercent: 9, resetAt: Date.now() + 4.4 * 3600000 },
          { label: 'Weekly', usedPercent: 41, resetAt: Date.now() + 50 * 3600000 },
          { label: 'Sonnet', usedPercent: 20, resetAt: Date.now() + 50 * 3600000 },
        ] };
      }
      if (command === 'read_usage_history') return { available: true, partial: false, periodDays: 30, recordCount: 30, scannedAt: Date.now(), today: '2026-10-15', days: Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, 16 + index)).toISOString().slice(0, 10), inputTokens: 800000, outputTokens: 200000, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 1000000, estimatedCostUsd: 7.5 })), models: [
        { name: 'claude-opus-5-5', totalTokens: 18000000 }, { name: 'claude-opus-5', totalTokens: 10000000 }, { name: 'claude-sonnet-5', totalTokens: 1800000 }, { name: 'claude-opus-4-8', totalTokens: 190000 }, { name: 'claude-sonnet-5-5', totalTokens: 10000 },
      ] };
    } } });
  }, { theme, expired });
}

for (const theme of ['dark', 'light']) {
  test(`${theme} reference layout keeps live quotas, combined totals, trend and five models visible without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 660 });
    await referenceBridge(page, theme);
    await page.goto('/?view=quick');
    await page.getByRole('button', { name: 'Claude details' }).click();
    await expect(page.getByRole('progressbar', { name: 'Claude Session remaining' })).toHaveAttribute('aria-valuenow', '91');
    await expect(page.locator('.quick-plan')).toHaveText('Team');
    await expect(page.locator('.quick-usage-totals > div')).toHaveCount(3);
    await expect(page.locator('.quick-usage-totals')).toContainText('~$225.00');
    await expect(page.locator('.quick-models dl > div')).toHaveCount(5);
    await expect(page.locator('.quick-models')).toContainText('<0.1%');
    await page.screenshot({ path: `artifacts/local/compact-reference-${theme}-${test.info().project.name}.png` });
    const dimensions = await page.locator('.quick-scroll').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const lastModel = await page.locator('.quick-models dl > div').last().boundingBox();
    const footer = await page.locator('.quick-footer').boundingBox();
    expect(lastModel!.y + lastModel!.height).toBeLessThan(footer!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.locator('.quick-more-limits summary').click();
    await expect(page.getByRole('progressbar', { name: 'Claude Sonnet remaining' })).toBeVisible();
  });
}

test('expired sign-in preserves compact real activity and shows unavailable quotas without zero bars', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await referenceBridge(page, 'dark', true);
  await page.goto('/?view=quick');
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.quick-metrics-unavailable .quick-meter > span').first()).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
  await expect(page.locator('.quick-reconnect')).toContainText('Renew your Claude sign-in');
  await expect(page.locator('.quick-models dl > div')).toHaveCount(5);
  await page.screenshot({ path: `artifacts/local/compact-reference-expired-${test.info().project.name}.png` });
  const size = await page.locator('.quick-scroll').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
});
