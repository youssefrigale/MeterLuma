import { test, expect, type Page } from '@playwright/test';

const NOT_AFFILIATED = 'MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor).';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(cached => {
    // A saved preview preference must migrate to live mode in the shipped build.
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true, legalVersion: '1.1-providers-6', liveProviders: ['claude', 'codex', 'cursor'], enabled: ['claude', 'codex', 'cursor'] }));
    if (cached) { const settings = JSON.parse(localStorage.getItem('meterluma.settings.v2')!); settings.alerts = [{ key: 'test', providerId: 'cursor', threshold: 80, enabled: true }]; localStorage.setItem('meterluma.settings.v2', JSON.stringify(settings)); }
    const calls: { command: string; providerId?: string }[] = [];
    Object.assign(window, { isTauri: true, nativeCalls: calls, __TAURI_INTERNALS__: { invoke: async (command: string, args: { providerId?: string } = {}) => {
      calls.push({ command, providerId: args.providerId });
      if (command === 'refresh_provider') {
        if (args.providerId === 'claude') throw new Error('Claude quotas must never be requested');
        if (args.providerId === 'cursor') throw { code: 'rate_limited', message: 'The provider is limiting requests.', retryAt: Date.now() + 3600000, ...(cached ? { lastSnapshot: { id: 'cursor', name: 'Cursor', plan: 'Pro', color: '#515157', initials: '', spendToday: null, fetchedAt: Date.now() - 120000, metrics: [{ label: 'Monthly', usedPercent: 90, resetAt: Date.now() + 3600000 }] } } : {}) };
        return { id: 'codex', name: 'Codex', plan: 'Subscription', color: '#515157', initials: '', spendToday: null, fetchedAt: Date.now(), metrics: [{ label: 'Weekly', usedPercent: 10, resetAt: Date.now() + 3600000 }] };
      }
      if (command === 'read_usage_history') return { available: true, partial: false, recordCount: 1, periodDays: 30, scannedAt: Date.now(), today: '2026-10-15', coverageStart: '2026-10-15', days: [{ date: '2026-10-15', inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 110, estimatedCostUsd: args.providerId === 'claude' ? 0.01 : null, unpricedTokens: 0 }], models: [{ name: 'recorded-model', totalTokens: 110 }] };
    } } });
  }, test.info().title.startsWith('cached quotas'));
});

const calls = (page: Page) => page.evaluate(() => (window as unknown as { nativeCalls: { command: string; providerId?: string }[] }).nativeCalls);

test('cached quotas stay visible during throttling and are labeled without triggering alerts', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cursor details' }).click();
  await expect(page.getByRole('progressbar', { name: 'Cached Cursor Monthly remaining' })).toHaveAttribute('aria-valuenow', '10');
  await expect(page.locator('.quick-plan')).toHaveText('Cached quotas');
  await expect(page.locator('.quick-cache-notice')).toContainText('Cached quotas from');
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Cached from/);
  await expect(page.getByRole('region', { name: 'Usage alerts' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Cursor details' }).click();
  await expect(page.getByRole('progressbar', { name: 'Cached Cursor Monthly remaining' })).toBeVisible();
});

test('release removes demo controls and distinguishes local history from live quotas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(2);
  const claude = page.getByRole('article').filter({ hasText: 'Claude' });
  await expect(claude).toContainText('Local history only');
  await expect(claude.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Codex Weekly remaining' })).toHaveAttribute('aria-valuenow', '90');
  const cursor = page.getByRole('status').filter({ hasText: 'Cursor' });
  await expect(cursor).toContainText('The provider is limiting requests.');
  await expect(cursor).not.toContainText('?');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Demo preview', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Use sample data' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.locator('.quick-connection').filter({ hasText: 'Codex' })).toContainText('Connected');
  await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/prototype|Internal beta|development build|Desktop preview|Sample data/i);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  // The migrated live mode is what the next saved change writes back.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: '15 min', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('meterluma.settings.v2')!).demo)).toBe(false);
  const native = await calls(page);
  expect(native.filter(call => call.command === 'refresh_provider' && call.providerId === 'claude')).toEqual([]);
  expect(native.filter(call => call.command === 'read_usage_history' && call.providerId === 'cursor')).toEqual([]);
});

test('release tray shows rate limiting and disables retries until the deadline', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cursor details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Rate limited');
  await expect(page.locator('.quick-reconnect')).toContainText('Usage paused. Retrying in');
  await expect(page.getByRole('button', { name: 'Waiting', exact: true })).toBeDisabled();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.quick-detail')).toContainText('Unofficial');
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Usage retry in/);
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Local history');
  await expect(page.locator('.quick-models')).toContainText('recorded-model');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Use sample data' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.locator('.quick-help')).toContainText(NOT_AFFILIATED);
  await expect(page.locator('.quick-help')).toContainText(/MeterLuma v\d+\.\d+\.\d+\. Free for personal/);
  await expect(page.locator('.quick-help')).not.toContainText(/Internal beta|prototype|development build/i);
  await page.reload();
  await page.getByRole('button', { name: 'Cursor details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Rate limited');
});
