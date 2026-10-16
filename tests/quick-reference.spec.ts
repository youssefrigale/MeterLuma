import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function referenceBridge(page: Page, theme: string, providerId: 'codex' | 'claude', expired = false) {
  await page.addInitScript(({ theme, providerId, expired }) => {
    localStorage.setItem('meterluma.settings.v2', JSON.stringify({ theme, legalVersion: '1.1-providers-4', demo: false, enabled: [providerId], liveProviders: [providerId] }));
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string, args: { providerId?: string } = {}) => {
      if (command === 'refresh_provider') {
        if (args.providerId === 'claude') throw new Error('Claude quotas must never be requested');
        if (expired) throw 'Your sign-in has expired. Sign in again using the provider app.';
        return { id: 'codex', name: 'Codex', plan: 'Team', color: '#d97757', initials: '', spendToday: null, fetchedAt: Date.now(), metrics: [
          { label: 'Session', usedPercent: 9, resetAt: Date.now() + 4.4 * 3600000 },
          { label: 'Weekly', usedPercent: 41, resetAt: Date.now() + 50 * 3600000 },
        ] };
      }
      // Claude days carry priced API-value estimates; Codex days with tokens have no price.
      const priced = providerId === 'claude';
      if (command === 'read_usage_history') return { available: true, partial: false, periodDays: 30, recordCount: 30, scannedAt: Date.now(), today: '2026-10-15', coverageStart: '2026-09-16', days: Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, 16 + index)).toISOString().slice(0, 10), inputTokens: 800000, outputTokens: 200000, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 1000000, estimatedCostUsd: priced ? 7.5 : null, unpricedTokens: 0 })), models: [
        { name: 'model-alpha', totalTokens: 18000000 }, { name: 'model-beta', totalTokens: 10000000 }, { name: 'model-gamma', totalTokens: 1800000 }, { name: 'model-delta', totalTokens: 190000 }, { name: 'model-epsilon', totalTokens: 10000 },
      ] };
    } } });
  }, { theme, providerId, expired });
}

async function fitsWithoutScrolling(page: Page) {
  const dimensions = await page.locator('.quick-scroll').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  const lastModel = await page.locator('.quick-models dl > div').last().boundingBox();
  const footer = await page.locator('.quick-footer').boundingBox();
  expect(lastModel!.y + lastModel!.height).toBeLessThan(footer!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const theme of ['dark', 'light']) {
  test(`${theme} reference layout keeps live quotas, combined totals, trend and five models visible without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 660 });
    await referenceBridge(page, theme, 'codex');
    await page.goto('/');
    await page.getByRole('button', { name: 'Codex details' }).click();
    await expect(page.getByRole('progressbar', { name: 'Codex Session remaining' })).toHaveAttribute('aria-valuenow', '91');
    await expect(page.locator('.quick-plan')).toHaveText('Team');
    await expect(page.locator('.quick-usage-totals > div')).toHaveCount(3);
    await expect(page.locator('.quick-usage-totals')).toContainText('30M tokens');
    await expect(page.locator('.quick-usage-totals')).not.toContainText('$');
    await expect(page.locator('.quick-models dl > div')).toHaveCount(5);
    await expect(page.locator('.quick-models')).toContainText('<0.1%');
    await page.screenshot({ path: `artifacts/local/compact-reference-${theme}-${test.info().project.name}.png` });
    await fitsWithoutScrolling(page);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
  });

  test(`${theme} Claude history layout shows estimated value and five models without quotas or scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 660 });
    await referenceBridge(page, theme, 'claude');
    await page.goto('/');
    await page.getByRole('button', { name: 'Claude details' }).click();
    await expect(page.locator('.quick-plan')).toHaveText('Local history');
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.locator('.quick-usage-totals')).toContainText('~$225.00');
    await expect(page.locator('.quick-models dl > div')).toHaveCount(5);
    await expect(page.locator('.quick-models')).toContainText('<0.1%');
    await page.screenshot({ path: `artifacts/local/compact-reference-claude-${theme}-${test.info().project.name}.png` });
    await fitsWithoutScrolling(page);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
  });
}

test('expired sign-in preserves compact real activity and shows unavailable quotas without zero bars', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await referenceBridge(page, 'dark', 'codex', true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.quick-metrics-unavailable .quick-meter > span').first()).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible();
  await expect(page.locator('.quick-reconnect')).toContainText('Renew your Codex sign-in');
  await expect(page.locator('.quick-models dl > div')).toHaveCount(5);
  await page.screenshot({ path: `artifacts/local/compact-reference-expired-${test.info().project.name}.png` });
  const size = await page.locator('.quick-scroll').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
});
