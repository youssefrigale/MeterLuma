import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('fresh startup and saved prototype preferences use real-data mode without invented numbers', async ({ page }) => {
  await page.goto('/?view=quick');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText('Sample data only', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem('meterluma.settings.v1', JSON.stringify({ demo: true, theme: 'dark', enabled: ['codex'] }));
    localStorage.removeItem('meterluma.settings.v2');
  });
  await page.reload();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Codex details' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('real device tokens and model shares remain available when quota credentials expire', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('meterluma.settings.v2', JSON.stringify({ legalVersion: '1.1-providers-3', demo: false, liveProviders: ['claude'], enabled: ['claude'] }));
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string) => {
      if (command === 'refresh_provider') throw 'Renew the provider sign-in to fetch allowances.';
      if (command === 'read_usage_history') return {
        available: true, partial: false, recordCount: 2, scannedAt: Date.now(), today: '2026-10-13',
        days: [{ date: '2026-10-12', inputTokens: 800, cachedInputTokens: 600, cacheWriteTokens: 0, outputTokens: 200, totalTokens: 1000 }, { date: '2026-10-13', inputTokens: 1800, cachedInputTokens: 1400, cacheWriteTokens: 0, outputTokens: 200, totalTokens: 2000 }],
        models: [{ name: 'recorded-model-a', totalTokens: 2000 }, { name: 'recorded-model-b', totalTokens: 1000 }],
      };
    } } });
  });
  await page.goto('/?view=quick');
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.usage-history')).toContainText('2K tokens');
  await expect(page.locator('.usage-history')).toContainText('recorded-model-a');
  await expect(page.locator('.usage-history')).toContainText('66.7%');
  await expect(page.locator('.usage-history')).toContainText('Recorded on this device');
  await expect(page.locator('.quick-statistics')).toHaveCount(0);
  await expect(page.locator('.quick-models dl > div')).toHaveCount(2);
  await expect(page.locator('.quick-sparkbars')).toHaveCount(1);
  await expect(page.locator('.quick-usage-totals')).not.toContainText('$');
  await expect(page.locator('.quick-reconnect')).toContainText('Renew your Claude sign-in');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.goto('/?page=dashboard');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.locator('.usage-history')).toContainText('recorded-model-a');
});
