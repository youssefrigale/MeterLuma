import { test, expect } from '@playwright/test';
import { LEGAL, countCalls, holdNative, nativeBridge, nativeCalls, releaseNative } from './fixtures';

const quota = { plan: 'Plus', metrics: [{ label: 'Session', usedPercent: 32, resetIn: 3_600_000 }] };
const fixtureToken = 'synthetic-account-access-token';

test('sidebar keeps active local profiles, excludes paused and token-suppressed profiles, and leaves a removed page', async ({ page, context }) => {
  await nativeBridge(page, { settings: {
    legalVersion: LEGAL, liveProviders: [], tokenProviders: ['cursor'],
    profiles: [
      { key: 'active', providerId: 'claude', label: 'Active history', directory: 'C:\\fixture\\active' },
      { key: 'paused', providerId: 'codex', label: 'Paused profile', directory: 'C:\\fixture\\paused', paused: true },
      { key: 'token-mode', providerId: 'cursor', label: 'Old Cursor', directory: 'C:\\fixture\\cursor' },
    ],
  } });
  await page.goto('/');
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Claude details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cost', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(() => {
    const key = 'meterluma.settings.v2';
    const settings = JSON.parse(localStorage.getItem(key)!);
    settings.profiles = settings.profiles.filter((row: { key: string }) => row.key !== 'active');
    localStorage.setItem(key, JSON.stringify(settings));
  });
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Costs', exact: true })).toHaveCount(0);
});

test('updating from local-only connections pauses existing profiles until the user chooses a new source', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: '1.1-providers-4', enabled: ['claude', 'codex', 'cursor'], liveProviders: ['claude', 'codex', 'cursor'], profiles: [{ key: 'old-local', providerId: 'claude', label: 'Old history', directory: 'C:\\fixture\\claude' }] }, quotas: { codex: quota, cursor: quota } });
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Before you connect' });
  await gate.getByRole('checkbox').check();
  await gate.getByRole('button', { name: 'Agree and continue' }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  expect(await countCalls(page, 'read_usage_history')).toBe(0);
  expect(await countCalls(page, 'refresh_provider')).toBe(0);
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(0);
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('meterluma.settings.v2')!));
  expect(settings.liveProviders).toEqual([]);
  expect(settings.tokenProviders).toEqual(['codex', 'cursor']);
  expect(settings.profiles[0].paused).toBe(true);
  expect(settings.profiles[0].directory).toBe('C:\\fixture\\claude');
});

test('a supplied Codex token fetches limits without local history and never enters saved preferences', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['codex'] }, quotas: { codex: quota } });
  await page.goto('/');
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await page.getByLabel('Account access token', { exact: true }).fill(fixtureToken);
  await page.getByLabel('ChatGPT account ID (optional)').fill('fixture-account');
  await page.getByRole('button', { name: 'Connect with token', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Codex details', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '68');
  await expect(page.getByText('Connected with an account token.', { exact: false })).toBeVisible();
  const calls = await nativeCalls(page);
  expect(calls.filter(c => c.command === 'read_usage_history')).toHaveLength(0);
  expect(calls.filter(c => c.command === 'refresh_provider').every(c => c.args.tokenMode === true && c.args.configDirectory === null)).toBe(true);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain(fixtureToken);
  expect(storage).not.toContain('fixture-account');
  await page.reload();
  await expect(page.getByRole('progressbar')).toBeVisible();
  expect(await countCalls(page, 'read_usage_history')).toBe(0);
});

test('token mode pauses saved local profiles and disconnect never falls back to them', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['codex'], liveProviders: ['codex'], tokenProviders: ['codex'], profiles: [{ key: 'previous-local', providerId: 'codex', label: 'Previous local account', directory: 'C:\\fixture\\old-profile' }] }, quotas: { codex: quota } });
  await page.goto('/');
  await expect(page.getByRole('progressbar')).toBeVisible();
  expect(await countCalls(page, 'read_usage_history')).toBe(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByText(/Previous local account.*paused/)).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect Codex', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Codex', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Codex details', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Costs', exact: true })).toHaveCount(0);
  expect(await countCalls(page, 'forget_account_token')).toBe(1);
  await page.reload();
  expect(await countCalls(page, 'read_usage_history')).toBe(0);
  expect((await nativeCalls(page)).filter(c => c.command === 'refresh_provider').every(c => c.args.tokenMode === true)).toBe(true);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('a rejected token is cleared from the form without enabling a connection', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['cursor'] }, quotas: { cursor: quota }, tokenError: 'The account token has expired. Replace it in Connections.' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Cursor', exact: true }).click();
  await page.getByLabel('Account access token', { exact: true }).fill(fixtureToken);
  await page.getByRole('button', { name: 'Connect with token', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByLabel('Account access token', { exact: true })).toHaveValue('');
  expect(await countCalls(page, 'refresh_provider')).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('meterluma.settings.v2'))).not.toContain(fixtureToken);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Cursor', exact: true })).toBeVisible();
});

test('an in-flight token check cannot be dismissed before it finishes', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['cursor'] }, quotas: { cursor: quota } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Cursor', exact: true }).click();
  await holdNative(page);
  await page.getByLabel('Account access token', { exact: true }).fill(fixtureToken);
  await page.getByRole('button', { name: 'Connect with token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking token…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Account access token', { exact: true })).toHaveValue('');
  await releaseNative(page);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect Cursor', exact: true })).toBeVisible();
});

test('failed removal keeps the connection selected and Claude has no token form', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['cursor', 'claude'], liveProviders: ['cursor'], tokenProviders: ['cursor'] }, quotas: { cursor: quota }, forgetTokenError: 'Storage unavailable.' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Cursor', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be removed');
  await expect(page.getByRole('button', { name: 'Disconnect Cursor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  await expect(page.getByLabel('Account access token', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use local profile', exact: true })).toBeVisible();
});
