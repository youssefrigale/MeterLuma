import { test, expect, type Page } from '@playwright/test';

async function nativeBridge(page: Page, shouldFail = false, quick = false, providerId: 'cursor' | 'codex' = 'codex') {
  await page.addInitScript(({ shouldFail, quick, providerId }) => {
    localStorage.setItem('meterluma.settings.v2', JSON.stringify(quick ? { legalVersion: '1.1-providers-6', demo: false, remaining: true, enabled: [providerId], liveProviders: [providerId] } : { legalVersion: '1.1-providers-6', remaining: false, demo: true }));
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true,
      meterlumaTestCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { providerId?: string }) => {
          calls.push(command);
          if (command === 'set_tray_summary' || command === 'resize_quick' || command === 'open_provider_page') return;
          if (command !== 'refresh_provider' || args?.providerId !== providerId) throw new Error('Unexpected native request');
          if (shouldFail) throw 'Your sign-in has expired. Sign in again using the provider app.';
          return {
            id: providerId, name: { cursor: 'Cursor', codex: 'Codex' }[providerId], plan: 'Subscription', color: '#dca18b', initials: '', spendToday: null,
            metrics: [{ label: 'Session', usedPercent: 81.4, resetAt: null }],
          };
        },
      },
    });
  }, { shouldFail, quick, providerId });
}

async function connectCodex(page: Page) {
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await page.getByRole('dialog', { name: 'Connect Codex', exact: true }).getByRole('button', { name: 'Use local profile' }).click();
}

test('live connections require selection and never mix sample spending with real limits', async ({ page }) => {
  await nativeBridge(page);
  await page.goto('/');
  const providerCalls = () => page.evaluate(() => (window as unknown as { meterlumaTestCalls: string[] }).meterlumaTestCalls.filter(call => call === 'refresh_provider').length);
  expect(await providerCalls()).toBe(0);
  await connectCodex(page);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('progressbar', { name: 'Codex Session used' })).toHaveAttribute('aria-valuenow', '81.4');
  await expect(page.getByText('Reset time unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).not.toContainText('$4.26');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.locator('.quick-statistics')).toContainText('Unavailable');
  await expect(page.locator('.quick-models, .quick-sparkbars')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Codex', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('expired local credentials produce an error instead of fake zero usage', async ({ page }) => {
  await nativeBridge(page, true);
  await page.goto('/');
  await connectCodex(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Your sign-in has expired. Sign in again using the provider app.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText('$0.00');
});

test('live provider details keep unavailable history separate and route website buttons through the native bridge', async ({ page }) => {
  await nativeBridge(page, false, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.locator('.quick-statistics')).toContainText('Unavailable');
  await expect(page.locator('.quick-statistics')).not.toContainText('$');
  await expect(page.locator('.quick-models, .quick-sparkbars')).toHaveCount(0);
  await expect(page.getByText('Reset time unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Status', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { meterlumaTestCalls: string[] }).meterlumaTestCalls)).toContain('open_provider_page');
});

test('Cursor local sign-in quota connection is available and labeled unofficial', async ({ page }) => {
  await nativeBridge(page, false, false, 'cursor');
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Cursor', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Cursor', exact: true });
  await expect(dialog).toContainText('native process');
  await expect(dialog).toContainText('Unofficial');
  await dialog.getByRole('button', { name: 'Use local profile' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Cursor Session used' })).toHaveAttribute('aria-valuenow', '81.4');
  await expect(page.getByText(/paused pending|disabled pending/)).toHaveCount(0);
  // Cursor token history is not recorded locally, so it is never requested.
  expect(await page.evaluate(() => (window as unknown as { meterlumaTestCalls: string[] }).meterlumaTestCalls)).not.toContain('read_usage_history');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Cursor', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
});
