import { test, expect } from '@playwright/test';
import { LEGAL, countCalls, history, holdNative, nativeBridge, releaseNative } from './fixtures';

const start = new Date('2026-10-20T10:00:00Z');
const quotas = { codex: { plan: 'Plus', metrics: [{ label: 'Session', usedPercent: 25, resetIn: 3_600_000 }] } };

test('reopening after a long wall-clock gap refreshes old usage once and updates reset timers', async ({ page }) => {
  await page.clock.install({ time: start });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['codex'], liveProviders: ['codex'], refreshMinutes: 60 }, quotas, histories: { codex: history() }, rising: true });
  await page.goto('/');
  const meter = page.getByRole('progressbar', { name: 'Codex Session remaining' });
  await expect(meter).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await countCalls(page, 'refresh_provider');
  await expect(meter).toHaveAttribute('aria-valuenow', String(75 - (before - 1) * 5));
  // Move wall time without running timers: a suspended renderer must catch up when reopened.
  await page.clock.setSystemTime(new Date(start.getTime() + 2 * 3_600_000));
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(meter).toHaveAttribute('aria-valuenow', String(75 - before * 5));
  expect(await countCalls(page, 'refresh_provider')).toBe(before + 1);
  await expect(page.locator('.quick-metric-caption')).toContainText('1h');
  await expect(page.locator('.quick-metric-caption')).not.toContainText('3h');
});

test('focus changes do not refetch a fresh allowance', async ({ page }) => {
  await page.clock.install({ time: start });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['codex'], liveProviders: ['codex'], refreshMinutes: 60 }, quotas, histories: { codex: history() } });
  await page.goto('/');
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await countCalls(page, 'refresh_provider');
  await page.clock.setSystemTime(new Date(start.getTime() + 20 * 60_000));
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.dispatchEvent(new Event('focus')); });
  expect(await countCalls(page, 'refresh_provider')).toBe(before);
});

test('reopening during a pending lookup does not start another lookup', async ({ page }) => {
  await page.clock.install({ time: start });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: ['codex'], liveProviders: ['codex'], refreshMinutes: 60 }, quotas, histories: { codex: history() }, rising: true });
  await page.goto('/');
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await holdNative(page);
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
  const before = await countCalls(page, 'refresh_provider');
  await page.clock.setSystemTime(new Date(start.getTime() + 2 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await countCalls(page, 'refresh_provider')).toBe(before);
  await releaseNative(page);
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
});

test('reopening cannot read providers before consent or after disconnect', async ({ page }) => {
  await page.clock.install({ time: start });
  await nativeBridge(page, { settings: { legalVersion: '', enabled: ['codex'], liveProviders: ['codex'] }, quotas, histories: { codex: history() } });
  await page.goto('/');
  await page.clock.setSystemTime(new Date(start.getTime() + 2 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await countCalls(page, 'refresh_provider')).toBe(0);
  const gate = page.getByRole('dialog', { name: 'Before you connect' });
  await gate.getByRole('checkbox').check();
  await gate.getByRole('button', { name: 'Agree and continue' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect Codex', exact: true }).click();
  const before = await countCalls(page, 'refresh_provider');
  await page.clock.setSystemTime(new Date(start.getTime() + 4 * 3_600_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await countCalls(page, 'refresh_provider')).toBe(before);
});
