import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(cached => {
    // A saved preview preference must migrate to live mode in the shipped build.
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true, legalVersion: '1.1-providers-3', liveProviders: ['claude', 'codex'], enabled: ['claude', 'codex'] }));
    if (cached) { const settings = JSON.parse(localStorage.getItem('meterluma.settings.v2')!); settings.alerts = [{ key: 'test', providerId: 'claude', threshold: 80, enabled: true }]; localStorage.setItem('meterluma.settings.v2', JSON.stringify(settings)); }
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: { invoke: async (command: string, args: { providerId?: string } = {}) => {
      if (command === 'refresh_provider') {
        if (args.providerId === 'claude') throw { code: 'rate_limited', message: 'The provider is limiting requests.', retryAt: Date.now() + 3600000, ...(cached ? { lastSnapshot: { id: 'claude', name: 'Claude', plan: 'Team', color: '#515157', initials: '', spendToday: null, fetchedAt: Date.now() - 120000, metrics: [{ label: 'Session', usedPercent: 90, resetAt: Date.now() + 3600000 }] } } : {}) };
        return { id: 'codex', name: 'Codex', plan: 'Subscription', color: '#515157', initials: '', spendToday: null, fetchedAt: Date.now(), metrics: [{ label: 'Weekly', usedPercent: 10, resetAt: Date.now() + 3600000 }] };
      }
      if (command === 'read_usage_history') return { available: true, partial: false, recordCount: 1, periodDays: 30, scannedAt: Date.now(), today: '2026-10-15', days: [{ date: '2026-10-15', inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 110 }], models: [{ name: 'recorded-model', totalTokens: 110 }] };
    } } });
  }, test.info().title.startsWith('cached quotas'));
});

test('cached quotas stay visible during throttling and are labeled without triggering alerts', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/?view=quick');
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.getByRole('progressbar', { name: 'Cached Claude Session remaining' })).toHaveAttribute('aria-valuenow', '10');
  await expect(page.locator('.quick-cache-notice')).toContainText('Cached quotas from');
  await expect(page.locator('.quick-footer')).toContainText('Cached from');
  await expect(page.getByRole('region', { name: 'Usage alerts' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.getByRole('progressbar', { name: 'Cached Claude Session remaining' })).toBeVisible();
});

test('release removes demo controls and distinguishes local history from live quotas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.summary-number').first()).toContainText('02 local profiles');
  await expect(page.locator('.main-footer')).toContainText('1 live connections');
  const claude = page.getByRole('article').filter({ hasText: 'Claude' });
  await expect(claude.locator('.connection-dot')).toHaveAttribute('data-state', 'rate_limited');
  await expect(claude).not.toContainText('Local history plan');
  await expect(page.locator('.live-status-list')).toContainText('rate limited. Retrying in');
  for (const tab of ['Connections', 'Settings']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Demo preview' })).toHaveCount(0);
    await expect(page.getByText('Demo preview', { exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('meterluma.settings.v2')!).demo)).toBe(false);
});

test('release tray shows rate limiting and disables retries until the deadline', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/?view=quick');
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Rate limited');
  await expect(page.locator('.quick-reconnect')).toContainText('Usage paused. Retrying in');
  await expect(page.getByRole('button', { name: 'Waiting', exact: true })).toBeDisabled();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.quick-models')).toContainText('recorded-model');
  await expect(page.locator('.quick-footer')).toContainText('Usage retry in');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Use sample data' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Rate limited');
});
