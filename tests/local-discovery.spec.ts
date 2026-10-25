import { test, expect } from '@playwright/test';
import { LEGAL, countCalls, history, nativeBridge, nativeCalls } from './fixtures';

const quota = { plan: 'Existing subscription', metrics: [{ label: 'Session', usedPercent: 25, resetIn: 3_600_000 }] };

test('after consent existing local connections appear without a login or token form', async ({ page }) => {
  await nativeBridge(page, { settings: {}, localProviders: ['claude', 'codex', 'cursor'], quotas: { codex: quota, cursor: quota }, histories: { claude: history(), codex: history() } });
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Before you connect' });
  await expect(gate).toBeVisible();
  expect(await countCalls(page, 'discover_local_providers')).toBe(0);
  expect(await countCalls(page, 'read_usage_history')).toBe(0);
  expect(await countCalls(page, 'refresh_provider')).toBe(0);
  await gate.getByRole('checkbox').check();
  await gate.getByRole('button', { name: 'Agree and continue' }).click();
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(3);
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  for (const provider of ['Claude', 'Codex', 'Cursor']) await expect(page.getByRole('button', { name: `Disconnect ${provider}`, exact: true })).toBeVisible();
  await expect(page.getByLabel('Account access token', { exact: true })).toHaveCount(0);
  expect(await countCalls(page, 'connect_account_token')).toBe(0);
  const calls = await nativeCalls(page);
  expect(calls.filter(call => call.command === 'refresh_provider').every(call => !call.args.tokenMode && call.args.providerId !== 'claude')).toBe(true);
  expect(calls.filter(call => call.command === 'read_usage_history').map(call => call.args.providerId)).toEqual(expect.arrayContaining(['claude', 'codex']));
});

test('unused token-first defaults migrate to detected local connections', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: '1.1-providers-5', tokenProviders: ['codex', 'cursor'], liveProviders: [] }, localProviders: ['codex'], quotas: { codex: quota }, histories: { codex: history() } });
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Before you connect' });
  await gate.getByRole('checkbox').check();
  await gate.getByRole('button', { name: 'Agree and continue' }).click();
  await expect(page.getByRole('button', { name: 'Codex details' })).toBeVisible();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('meterluma.settings.v2')!));
  expect(settings.liveProviders).toEqual(['codex']);
  expect(settings.tokenProviders).not.toContain('codex');
  expect(await countCalls(page, 'forget_account_token')).toBe(0);
});

test('disconnect survives rediscovery and restart without signing the provider out', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL }, localProviders: ['codex'], quotas: { codex: quota }, histories: { codex: history() } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Codex details' })).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Codex' }).click();
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(page.getByRole('button', { name: 'Codex details' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Costs', exact: true })).toHaveCount(0);
  expect(await countCalls(page, 'refresh_provider')).toBe(0);
  expect(await countCalls(page, 'forget_account_token')).toBe(0);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Codex' }).click();
  await expect(page.getByLabel('Account access token', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Use local profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex details' })).toBeVisible();
});

test('discovery respects hidden providers and paused custom profiles', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['claude', 'codex'], profiles: [{ key: 'paused', providerId: 'claude', label: 'Paused history', directory: 'C:/fixture/claude', paused: true }] }, localProviders: ['claude', 'codex', 'cursor'], quotas: { codex: quota }, histories: { codex: history() } });
  await page.goto('/');
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Codex details' })).toBeVisible();
  expect((await nativeCalls(page)).filter(call => ['refresh_provider', 'read_usage_history'].includes(call.command)).every(call => call.args.providerId === 'codex')).toBe(true);
  expect((await nativeCalls(page)).filter(call => call.command === 'discover_local_providers').every(call => JSON.stringify(call.args.providerIds) === '["codex"]')).toBe(true);
});

test('an active explicit token connection is not replaced by local discovery', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], tokenProviders: ['codex'] }, localProviders: ['codex'], quotas: { codex: quota } });
  await page.goto('/');
  await expect(page.getByRole('progressbar')).toBeVisible();
  expect(await countCalls(page, 'read_usage_history')).toBe(0);
  expect((await nativeCalls(page)).filter(call => call.command === 'refresh_provider').every(call => call.args.tokenMode === true)).toBe(true);
});
