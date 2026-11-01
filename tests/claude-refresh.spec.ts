import { test, expect, type Page } from '@playwright/test';
import { LEGAL, countCalls, history, nativeBridge, nativeCalls, holdNative, releaseNative } from './fixtures';

const start = new Date('2026-10-26T23:45:00Z');
const settings = { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude'], enabled: ['claude'], refreshMinutes: 60 };

// With rising quotas each lookup adds 5% use. Waits until the meter shows the newest lookup, so startup
// lookups (StrictMode runs effects twice in the dev server) cannot land after a call-count baseline.
async function settledCalls(page: Page, used: number) {
  const meter = page.getByRole('progressbar', { name: 'Claude Session remaining' });
  let calls = 0;
  await expect.poll(async () => {
    calls = await countCalls(page, 'refresh_provider');
    return calls > 0 && await meter.getAttribute('aria-valuenow') === String(Math.max(0, 100 - used - (calls - 1) * 5));
  }).toBe(true);
  return calls;
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
});

for (const recovery of ['background timer', 'resume'] as const) test(`Claude automatically exits cached mode after a rate limit via ${recovery}`, async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: { metrics: [{ label: 'Session', usedPercent: 42, resetIn: 2 * 3_600_000 }] } }, histories: { claude: history() } });
  await page.addInitScript(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    const retryAt = Date.now() + 90_000;
    bridge.invoke = async (command, args) => {
      const response = await invoke(command, args);
      if (command === 'refresh_provider' && args?.providerId === 'claude' && Date.now() < retryAt) {
        throw { code: 'rate_limited', message: 'Usage requests are rate limited.', retryAt, lastSnapshot: { ...(response as object), fetchedAt: Date.now() - 120_000, metrics: [{ label: 'Session', usedPercent: 80, resetAt: Date.now() + 3_600_000 }] } };
      }
      return response;
    };
  });
  await page.goto('/');
  await expect(page.getByRole('progressbar', { name: 'Cached Claude Session remaining' })).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByText(/Retrying automatically in/)).toBeVisible();
  const before = await countCalls(page, 'refresh_provider');
  if (recovery === 'background timer') {
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
    await page.clock.runFor(91_000);
  } else {
    // Move wall time without running timers, as when the WebView is suspended.
    await page.clock.setSystemTime(new Date(start.getTime() + 92_000));
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  }
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining', exact: true })).toHaveAttribute('aria-valuenow', '58');
  await expect(page.getByText(/Cached quotas from/)).toHaveCount(0);
  expect(await countCalls(page, 'refresh_provider')).toBe(before + 1);
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status).toMatchObject({ provider: 'claude', remaining: 58, cached: false });
});

for (const [used, seconds] of [[20, 60], [90, 30]]) test(`Claude at ${used}% used updates after ${seconds} seconds, including exhaustion in the menu bar`, async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: { metrics: [{ label: 'Session', usedPercent: used, resetIn: 2 * 3_600_000 }] } }, histories: { claude: history() }, rising: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  const meter = page.getByRole('progressbar', { name: 'Claude Session remaining' });
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await settledCalls(page, used);
  const remaining = Math.max(0, 100 - used - (before - 1) * 5);
  await expect(page.getByText(/^Last checked/)).toBeVisible();
  await page.clock.runFor(seconds * 1000 - 1);
  expect(await countCalls(page, 'refresh_provider')).toBe(before);
  await page.clock.runFor(1);
  await expect(meter).toHaveAttribute('aria-valuenow', String(Math.max(0, remaining - 5)));
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status).toMatchObject({ provider: 'claude', remaining: Math.max(0, remaining - 5) });
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(meter).toHaveAttribute('aria-valuenow', String(Math.max(0, remaining - 10)));
  expect((await nativeCalls(page)).filter(call => call.command === 'refresh_provider').at(-1)?.args.forceRefresh).toBe(true);
});

test('Claude rate-limit cooldown keeps a cached allowance labeled and prevents fast polling until retry', async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: { error: { code: 'rate_limited', message: 'Usage requests are rate limited.' }, retryIn: 90_000, snapshot: { metrics: [{ label: 'Session', usedPercent: 77, resetIn: 2 * 3_600_000 }] } } }, histories: { claude: history() } });
  await page.goto('/');
  await expect(page.getByText(/Cached quotas from/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await countCalls(page, 'refresh_provider');
  await page.clock.runFor(90_999);
  expect(await countCalls(page, 'refresh_provider')).toBe(before);
  await page.clock.runFor(1);
  await expect.poll(() => countCalls(page, 'refresh_provider')).toBe(before + 1);
});

test('a slow Claude lookup is not restarted by the faster refresh timer', async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: { metrics: [{ label: 'Session', usedPercent: 77, resetIn: 2 * 3_600_000 }] } }, histories: { claude: history() }, rising: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await settledCalls(page, 77);
  await holdNative(page);
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
  await page.clock.runFor(60_000);
  expect(await countCalls(page, 'refresh_provider')).toBe(before + 1);
  await releaseNative(page);
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining' })).toHaveAttribute('aria-valuenow', String(23 - before * 5));
});

test('reopening Claude after its faster refresh deadline catches up without waiting for a suspended timer', async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: { metrics: [{ label: 'Session', usedPercent: 77, resetIn: 2 * 3_600_000 }] } }, histories: { claude: history() }, rising: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await settledCalls(page, 77);
  await page.clock.setSystemTime(new Date(start.getTime() + 36_000));
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining' })).toHaveAttribute('aria-valuenow', String(23 - before * 5));
  expect(await countCalls(page, 'refresh_provider')).toBe(before + 1);
});

test('Refresh usage asks Codex and Cursor for a new reading while automatic lookups may reuse a brief cache', async ({ page }) => {
  // A banked Codex reset used on the website must appear on the next manual refresh, not after the native cache expires.
  const accounts = { legalVersion: LEGAL, liveProviders: ['codex', 'cursor'], enabled: ['codex', 'cursor'], refreshMinutes: 60 };
  await nativeBridge(page, { settings: accounts, quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 99, periodMinutes: 10_080, resetIn: 3 * 86_400_000 }] }, cursor: { metrics: [{ label: 'Monthly', usedPercent: 40, resetIn: 9 * 86_400_000 }] } }, histories: { codex: history() } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const lookups = async () => (await nativeCalls(page)).filter(call => call.command === 'refresh_provider');
  const startup = await lookups();
  expect(startup.map(call => call.args.providerId).sort()).toEqual(expect.arrayContaining(['codex', 'cursor']));
  expect(startup.every(call => call.args.forceRefresh === false)).toBe(true);
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect.poll(async () => (await lookups()).slice(startup.length).map(call => `${call.args.providerId}:${call.args.forceRefresh}`).sort()).toEqual(['codex:true', 'cursor:true']);
});
