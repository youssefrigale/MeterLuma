import { test, expect, type Page } from '@playwright/test';

async function nativeBridge(page: Page, shouldFail = false) {
  await page.addInitScript(({ shouldFail }) => {
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true,
      meterlumaTestCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { providerId?: string }) => {
          calls.push(command);
          if (command === 'set_tray_summary') return;
          if (command !== 'refresh_provider' || args?.providerId !== 'claude') throw new Error('Unexpected native request');
          if (shouldFail) throw 'Your sign-in has expired. Sign in again using the provider app.';
          return {
            id: 'claude', name: 'Claude', plan: 'Subscription', color: '#dca18b', initials: '✳', spendToday: null,
            metrics: [{ label: 'Session', usedPercent: 81.4, resetAt: null }],
          };
        },
      },
    });
  }, { shouldFail });
}

async function connectClaude(page: Page) {
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  await page.getByRole('dialog', { name: 'Connect Claude', exact: true }).getByRole('button', { name: 'Use local sign-in' }).click();
}

test('live connections require selection and never mix sample spending with real limits', async ({ page }) => {
  await nativeBridge(page);
  await page.goto('/');
  const providerCalls = () => page.evaluate(() => (window as unknown as { meterlumaTestCalls: string[] }).meterlumaTestCalls.filter(call => call === 'refresh_provider').length);
  expect(await providerCalls()).toBe(0);
  await connectClaude(page);
  await expect(page.getByText('Live mode', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('progressbar', { name: 'Claude Session used' })).toHaveAttribute('aria-valuenow', '81.4');
  await expect(page.getByText('Reset time unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).not.toContainText('$4.26');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spending history is next.' })).toBeVisible();
  await expect(page.locator('.chart')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Claude', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('expired local credentials produce an error instead of fake zero usage', async ({ page }) => {
  await nativeBridge(page, true);
  await page.goto('/');
  await connectClaude(page);
  await expect(page.getByText('Your sign-in has expired. Sign in again using the provider app.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.locator('.summary-grid')).not.toContainText('$0.00');
});
