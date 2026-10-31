import { test, expect } from '@playwright/test';
import { LEGAL, history, nativeBridge, nativeCalls } from './fixtures';

test.use({ viewport: { width: 360, height: 440 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });

const quota = { plan: 'Team', metrics: [{ label: 'Session', usedPercent: 18, resetIn: 5 * 3_600_000 }, { label: 'Weekly', usedPercent: 11, resetIn: 4 * 86_400_000 }] };
const quotaCalls = async (page: Parameters<typeof nativeCalls>[0]) => (await nativeCalls(page)).filter(call => call.command === 'refresh_provider' && call.args.providerId === 'claude');

test('an unused Claude session says it starts on first use, matching claude.ai, in both usage modes', async ({ page }) => {
  const unused = { plan: 'Team', metrics: [{ label: 'Session', usedPercent: 0, resetIn: null }, { label: 'Weekly', usedPercent: 3, resetIn: 6 * 86_400_000 }] };
  await nativeBridge(page, { settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude'], enabled: ['claude'], remaining: false }, quotas: { claude: unused }, histories: { claude: history() } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  const session = page.locator('.quick-metric').filter({ has: page.getByRole('heading', { name: 'Session', exact: true }) });
  await expect(session.locator('.quick-metric-caption')).toHaveText('0% usedStarts on first use');
  await expect(page.locator('.quick-metric').filter({ has: page.getByRole('heading', { name: 'Weekly', exact: true }) }).locator('.quick-metric-caption')).toContainText('3% used');
  await expect(page.getByText('Reset time unavailable', { exact: true })).toHaveCount(0);
});

test('existing history-only consent needs explicit opt-in before Claude quotas, and can return to history only', async ({ page }, testInfo) => {
  await nativeBridge(page, { settings: { legalVersion: '1.1-providers-6', claudeLive: true, theme: 'dark', liveProviders: ['claude'], enabled: ['claude'] }, quotas: { claude: quota }, histories: { claude: history({ tokens: 2000 }) } });
  await page.goto('/');
  await expect(page.getByText(/Local history only/)).toBeVisible();
  expect(await quotaCalls(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Enable live Claude usage', exact: true }).click();
  const consent = page.getByRole('dialog', { name: 'Enable live Claude usage', exact: true });
  await expect(consent).toContainText('api.anthropic.com');
  expect(await quotaCalls(page)).toHaveLength(0);
  await consent.getByRole('button', { name: 'Enable live usage', exact: true }).click();
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining', exact: true })).toHaveAttribute('aria-valuenow', '82');
  await expect(page.getByRole('progressbar', { name: 'Claude Weekly remaining', exact: true })).toHaveAttribute('aria-valuenow', '89');
  await expect(page.locator('.quick-plan')).toHaveText('Team');
  await expect(page.getByText('recorded-model', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('claude-live.png') });
  expect((await quotaCalls(page)).every(call => call.args.claudeLive === true)).toBe(true);
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Claude Session remaining', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Claude', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Claude', exact: true })).toContainText('api.anthropic.com');
  const beforeReconnect = (await quotaCalls(page)).length;
  await page.getByRole('button', { name: 'Use local profile', exact: true }).click();
  await expect.poll(async () => (await quotaCalls(page)).length).toBe(beforeReconnect + 1);
  const before = (await quotaCalls(page)).length;
  await page.getByRole('button', { name: 'Use history only', exact: true }).click();
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText('recorded-model', { exact: true })).toBeVisible();
  expect(await quotaCalls(page)).toHaveLength(before);
});

for (const cached of [false, true]) test(`Claude ${cached ? 'cached limits stay labeled' : 'sign-in failure preserves local history'}`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude'], enabled: ['claude'] },
    quotas: { claude: { error: { code: cached ? 'rate_limited' : 'sign_in_required', message: cached ? 'Usage requests are rate limited.' : 'Sign in to Claude Code to read usage.' }, ...(cached ? { retryIn: 3_600_000, snapshot: { ...quota, ageMs: 120_000 } } : {}) } },
    histories: { claude: history({ tokens: 2000 }) },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect(page.getByText('recorded-model', { exact: true })).toBeVisible();
  await expect(page.locator('.quick-reconnect').first()).toContainText(cached ? 'Cached quotas' : 'Renew your Claude sign-in');
  if (cached) await expect(page.getByRole('progressbar', { name: 'Cached Claude Session remaining', exact: true })).toHaveAttribute('aria-valuenow', '82');
  else await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(2);
});
