import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, SETTINGS_KEY, countCalls, history, holdNative, lastExport, nativeBridge, nativeCalls, releaseNative, type QuotaMock } from './fixtures';
import { activeAlerts, alertFreshness } from '../src/Alerts';
import type { Provider } from '../src/model';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const NOT_AFFILIATED = 'MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor).';
const codexQuota: QuotaMock = { plan: 'Plus', metrics: [{ label: 'Session', usedPercent: 25, resetIn: 3_600_000 }, { label: 'Weekly', usedPercent: 40, resetIn: 86_400_000 }] };
const cursorQuota: QuotaMock = { plan: 'Pro', metrics: [{ label: 'Monthly', usedPercent: 30, resetIn: 10 * 86_400_000 }] };
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY);
const axe = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

test('auto-refresh keeps quotas, details and recorded history visible while data reloads', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00Z') });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: codexQuota }, histories: { codex: history() } });
  await page.goto('/');
  const meter = page.getByRole('progressbar', { name: 'Codex Session remaining' });
  await expect(meter).toHaveAttribute('aria-valuenow', '75');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Plus');
  await expect(page.locator('.usage-history')).toContainText('recorded-model');
  const before = await countCalls(page, 'refresh_provider');
  await holdNative(page);
  await page.clock.fastForward('05:01');
  await expect.poll(() => countCalls(page, 'refresh_provider')).toBe(before + 1);
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
  await expect(meter).toHaveAttribute('aria-valuenow', '75');
  await expect(page.locator('.usage-history')).toContainText('recorded-model');
  await expect(page.getByText(/Reading Codex/)).toHaveCount(0);
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Fetched/);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(meter).toHaveAttribute('aria-valuenow', '75');
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Updated/);
  await releaseNative(page);
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.locator('.usage-history')).toContainText('recorded-model');
});

test('an older refresh response never overwrites a newer one', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00Z') });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: codexQuota }, histories: { codex: history() }, rising: true });
  await page.goto('/');
  await expect(page.getByRole('progressbar', { name: 'Codex Session remaining' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const before = await countCalls(page, 'refresh_provider');
  await holdNative(page);
  await page.clock.fastForward('05:01');
  await expect.poll(() => countCalls(page, 'refresh_provider')).toBe(before + 1);
  // Changing the window starts a newer refresh while the automatic one is still pending.
  await page.getByLabel('Recorded history window').selectOption('90');
  await expect.poll(() => countCalls(page, 'refresh_provider')).toBe(before + 2);
  const newest = 75 - (before + 1) * 5;
  await releaseNative(page, true);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const meter = page.getByRole('progressbar', { name: 'Codex Session remaining' });
  await expect(meter).toHaveAttribute('aria-valuenow', String(newest));
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(meter).toHaveAttribute('aria-valuenow', String(newest));
});

test('settings that cannot be stored show a message and the panel keeps working', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true }));
    Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'dark theme', exact: true }).click();
  await expect(page.getByText('Your settings could not be saved on this device.')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test.describe('outside the en-US locale and UTC', () => {
  test.use({ locale: 'de-DE', timezoneId: 'Asia/Tokyo' });
  test('history dates and coverage render from local calendar days', async ({ page }) => {
    await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['claude'], enabled: ['claude'] }, histories: { claude: history({ recordedDays: 10, tokens: 1500, cost: 0.25 }) } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Claude details' }).click();
    const panel = page.locator('.usage-history');
    await expect(panel.locator('.quick-usage-totals')).toContainText(/Since 6\. Okt/);
    await expect(panel.locator('.quick-sparkbars i.unrecorded')).toHaveCount(20);
    await expect(panel).toContainText('~$2.50');
    await axe(page);
  });
});

test('Claude connects as recorded local history and never requests Claude quotas', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false }, histories: { claude: history({ tokens: 2000, cost: 0.5 }) } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.locator('.quick-connection').filter({ hasText: 'Claude' })).toContainText('Recorded token history from local Claude Code logs');
  await page.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Claude', exact: true });
  await expect(dialog).toContainText("MeterLuma reads token counts from Claude Code's local logs. It does not read the Claude sign-in or contact Anthropic.");
  await expect(dialog).not.toContainText(/credential|renew|write-back/i);
  await dialog.getByRole('button', { name: 'Use local profile' }).click();
  await expect(page.locator('.quick-connection').filter({ hasText: 'Claude' })).toContainText('Connected · local history');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: 'Claude' });
  await expect(card).toContainText('Local history only');
  await expect(card).toContainText('2K');
  await expect(card.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await expect(page.getByText(/Renew your Claude sign-in|Claude sign-in to see limits/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Local history');
  await expect(page.locator('.quick-detail')).toContainText("reads token counts from Claude Code's local logs");
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('.quick-reconnect, .quick-metrics-unavailable')).toHaveCount(0);
  const calls = await nativeCalls(page);
  expect(calls.filter(call => call.command === 'refresh_provider')).toEqual([]);
  expect(calls.filter(call => call.command === 'read_usage_history' && call.args.providerId === 'claude').length).toBeGreaterThan(0);
});

test('saved Claude alert rules from earlier versions are dropped safely', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: '1.1-providers-3', demo: false, liveProviders: ['claude', 'codex'], enabled: ['claude', 'codex'], alerts: [{ key: 'old-claude', providerId: 'claude', threshold: 80, enabled: true }, { key: 'codex-rule', providerId: 'codex', threshold: 90, enabled: true }] }, quotas: { codex: codexQuota }, histories: { claude: history(), codex: history() } });
  await page.goto('/');
  // The privacy revision changed, so consent is asked for again before any data is read.
  await expect(page.getByRole('dialog', { name: 'Before you connect' })).toBeVisible();
  expect((await nativeCalls(page)).filter(call => ['refresh_provider', 'read_usage_history'].includes(call.command))).toEqual([]);
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and continue' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const alerts = page.locator('.feature-panel').filter({ hasText: 'Custom usage alerts' });
  await expect(alerts.getByRole('checkbox', { name: 'Codex · 90% used' })).toBeChecked();
  await expect(alerts.getByRole('checkbox', { name: /Claude/ })).toHaveCount(0);
  await expect(alerts.locator('select option')).toHaveText(['Codex', 'Cursor']);
  expect((await saved(page)).alerts.map((rule: { key: string }) => rule.key)).toEqual(['codex-rule']);
});

test('repeated Escape and a forced native close keep the first-run license gate open', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: '', demo: false, liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: codexQuota } });
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Before you connect' });
  await expect(gate).toBeVisible();
  for (let press = 0; press < 3; press++) await page.keyboard.press('Escape');
  await expect(gate).toBeVisible();
  expect(await gate.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
  await gate.evaluate(dialog => (dialog as HTMLDialogElement).close());
  await expect(gate).toBeVisible();
  expect(await gate.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
  expect((await nativeCalls(page)).filter(call => ['refresh_provider', 'read_usage_history'].includes(call.command))).toEqual([]);
});

test('dismissable dialogs ignore clicks inside their padding and close from the backdrop', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'View license' }).click();
  const dialog = page.getByRole('dialog', { name: 'Free for personal use.' });
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await expect(dialog).toBeVisible();
  await page.mouse.click(Math.max(2, box.x - 10), 4);
  await expect(dialog).toBeHidden();
});

test('reset preferences asks first in the app and keeps consent, connections and alerts', async ({ page }) => {
  await page.addInitScript(() => { window.confirm = () => { throw new Error('window.confirm is not allowed'); }; window.alert = () => { throw new Error('window.alert is not allowed'); }; });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, theme: 'dark', timeFormat: '24', resetStyle: 'absolute', historyDays: 90, liveProviders: ['codex'], enabled: ['codex'], alerts: [{ key: 'keep', providerId: 'codex', threshold: 90, enabled: true }] }, quotas: { codex: codexQuota }, histories: { codex: history({ days: 90 }) } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const open = page.getByRole('button', { name: 'Reset preferences' });
  await open.click();
  const confirm = page.getByRole('dialog', { name: 'Reset preferences?' });
  await expect(confirm).toContainText('Your connections, local accounts, usage alerts and license acceptance are kept.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  expect((await saved(page)).theme).toBe('dark');
  await open.click();
  await confirm.getByRole('button', { name: 'Reset preferences' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences reset' })).toBeVisible();
  const settings = await saved(page);
  expect(settings).toMatchObject({ legalVersion: LEGAL, liveProviders: ['codex'], theme: 'system', timeFormat: 'auto', resetStyle: 'relative', historyDays: 30 });
  expect(settings.alerts).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Before you connect' })).toHaveCount(0);
  await expect(page.getByRole('article').filter({ hasText: 'Codex' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('alert freshness follows the refresh interval and dismissal keys ignore millisecond jitter', () => {
  const now = Date.UTC(2026, 9, 15, 10, 0, 0);
  const provider: Provider = { id: 'codex', name: 'Codex', plan: 'Plus', initials: '', color: '#000', spendToday: null, fetchedAt: now, metrics: [{ label: 'Session', usedPercent: 95, resetAt: now + 3_600_000 }] };
  const rules = [{ key: 'rule', providerId: 'codex' as const, enabled: true, threshold: 80 }];
  expect([alertFreshness(5), alertFreshness(15), alertFreshness(30), alertFreshness(60)]).toEqual([10, 17, 32, 62].map(minutes => minutes * 60_000));
  expect(activeAlerts(rules, [provider], now + 11 * 60_000, false)).toHaveLength(0);
  expect(activeAlerts(rules, [provider], now + 29 * 60_000, false, 30)).toHaveLength(1);
  expect(activeAlerts(rules, [provider], now + 33 * 60_000, false, 30)).toHaveLength(0);
  expect(activeAlerts(rules, [{ ...provider, historyOnly: true }], now, false)).toHaveLength(0);
  const key = activeAlerts(rules, [provider], now, false)[0].key;
  expect(activeAlerts(rules, [{ ...provider, metrics: [{ ...provider.metrics[0], resetAt: now + 3_600_000 + 7 }] }], now, false)[0].key).toBe(key);
});

test('alerts stay visible through a 30-minute refresh interval', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00Z') });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, refreshMinutes: 30, liveProviders: ['codex'], enabled: ['codex'], alerts: [{ key: 'rule', providerId: 'codex', threshold: 20, enabled: true }] }, quotas: { codex: codexQuota }, histories: { codex: history() } });
  await page.goto('/');
  const alerts = page.getByRole('region', { name: 'Usage alerts' });
  await expect(alerts).toContainText('Session is 25% used (alert at 20%).');
  const before = await countCalls(page, 'refresh_provider');
  await page.clock.fastForward('25:00');
  await expect(page.locator('.quick-metric-caption').first()).toContainText('Resets in 35m');
  await expect(alerts).toContainText('Session is 25% used (alert at 20%).');
  expect(await countCalls(page, 'refresh_provider')).toBe(before);
});

test('alert dismissals survive reloads', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['codex'], enabled: ['codex'], alerts: [{ key: 'rule', providerId: 'codex', threshold: 35, enabled: true }] }, quotas: { codex: codexQuota }, histories: { codex: history() } });
  await page.goto('/');
  const alerts = page.getByRole('region', { name: 'Usage alerts' });
  await expect(alerts).toContainText('Weekly is 40% used (alert at 35%).');
  await alerts.getByRole('button', { name: /Dismiss Codex: Weekly/ }).click();
  await expect(alerts).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article').filter({ hasText: 'Codex' })).toBeVisible();
  await expect(alerts).toHaveCount(0);
});

test('days before coverage render as not recorded and export as recorded=false', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['claude'], enabled: ['claude'] }, histories: { claude: history({ recordedDays: 10, tokens: 1000, cost: 0.25 }) } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details' }).click();
  const panel = page.locator('.usage-history');
  await expect(panel.locator('.quick-usage-totals')).toContainText('Since Oct 6');
  await expect(panel.locator('.quick-usage-totals')).toContainText('~$2.50 · 10K tokens');
  await expect(panel.locator('.quick-sparkbars i.unrecorded')).toHaveCount(20);
  await expect(panel.locator('.quick-sparkbars i:not(.unrecorded)')).toHaveCount(10);
  await expect(page.getByRole('img', { name: 'Recorded token usage since Oct 6: 10,000 tokens; 20 earlier days not recorded' })).toBeVisible();
  await expect(panel.locator('.quick-data-note')).toContainText('20 days in this window have no local logs and are shown as not recorded, not as zero.');
  await expect(panel.locator('.quick-data-note')).toContainText('Claude Code keeps local transcripts for 30 days by default (cleanupPeriodDays)');
  const unrecorded = await panel.locator('.quick-sparkbars i.unrecorded').first().evaluate(element => ({ height: element.getBoundingClientRect().height, background: getComputedStyle(element).backgroundImage }));
  expect(unrecorded.height).toBeGreaterThan(0);
  expect(unrecorded.background).toContain('repeating-linear-gradient');
  await axe(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = (await lastExport(page, 'csv')).replace(/^﻿/, '').trim().split('\r\n');
  expect(csv[0]).toBe('"mode","provider","account","date","recorded","input_tokens","cached_input_tokens","cache_write_tokens","output_tokens","total_tokens","unpriced_tokens","estimated_api_value_usd","partial","scope"');
  expect(csv[1]).toBe('"live","claude","Default local profile","2026-09-16","false","","","","","","","","false","Selected local profile on this device; not account-wide billing"');
  expect(csv.at(-1)).toContain('"2026-10-15","true","800","200","0","200","1000","0","0.25"');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = JSON.parse(await lastExport(page, 'json')).providers[0].history;
  expect(exported.coverageStart).toBe('2026-10-06');
  expect(exported.days[0]).toEqual({ date: '2026-09-16', recorded: false, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null, unpricedTokens: null });
  expect(exported.days.at(-1)).toMatchObject({ date: '2026-10-15', recorded: true, totalTokens: 1000, unpricedTokens: 0, estimatedCostUsd: 0.25 });
});

test('dollar estimates say how many tokens they exclude for unknown model prices', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['claude'], enabled: ['claude'] }, histories: { claude: history({ tokens: 1000, cost: 0.2, unpriced: 150 }) } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details' }).click();
  await expect(page.locator('.quick-unpriced')).toHaveText('Excludes 4,500 tokens from models without a known price.');
  await expect(page.locator('.quick-usage-totals')).toContainText('~$6.00 · 30K tokens');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Today estimated API value: $0.20' })).toBeVisible();
  await expect(page.locator('.quick-cost-notes')).toContainText('Excludes 150 tokens from models without a known price.');
  await expect(page.getByText('Not a bill or subscription charge.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '30 Days', exact: true }).click();
  await expect(page.getByRole('img', { name: '30 Days estimated API value: $6.00' })).toBeVisible();
});

test('Cursor is labeled unofficial on its connection option, overview and details', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false }, quotas: { cursor: cursorQuota } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const row = page.locator('.quick-connection').filter({ hasText: 'Cursor' });
  await expect(row.getByText('Unofficial', { exact: true })).toBeVisible();
  await expect(row).toContainText('Uses an undocumented Cursor endpoint');
  await expect(page.locator('.quick-connection').filter({ hasText: 'Codex' }).getByText('Unofficial', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Connect Cursor' }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Cursor' })).toContainText('Unofficial');
  await page.getByRole('dialog').getByRole('button', { name: 'Use local profile' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.quick-provider').filter({ hasText: 'Cursor' }).getByText('Unofficial', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cursor details' }).click();
  await expect(page.locator('.quick-detail .unofficial-note')).toContainText('Unofficial');
  await expect(page.locator('.quick-detail .unofficial-note')).toContainText('not endorsed by Cursor');
  await expect(page.locator('.quick-detail')).toContainText('Cursor token history is not recorded locally.');
  await expect(page.locator('.quick-statistics')).toHaveCount(0);
  await axe(page);
  expect((await nativeCalls(page)).filter(call => call.command === 'read_usage_history')).toEqual([]);
});

test('an elapsed rate-limit deadline triggers one retry instead of a refresh every second', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00Z') });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['cursor'], enabled: ['cursor'] }, quotas: { cursor: { error: { code: 'rate_limited', message: 'The provider is limiting requests.' }, retryIn: 60_000, snapshot: { plan: 'Pro', ageMs: 120_000, metrics: [{ label: 'Monthly', usedPercent: 40, resetIn: 86_400_000 }] } } } });
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: 'Cursor' })).toContainText('Cached quotas');
  const settled = await countCalls(page, 'refresh_provider');
  // The retry stays pending, as a slow provider would; its row must not keep the elapsed deadline alive.
  await holdNative(page);
  await page.clock.fastForward('01:02');
  await expect.poll(() => countCalls(page, 'refresh_provider')).toBe(settled + 1);
  await page.clock.runFor('00:10');
  expect(await countCalls(page, 'refresh_provider')).toBe(settled + 1);
});

test('Cursor-only users get an explanation instead of an empty history and a dead CSV button', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['cursor'], enabled: ['cursor'] }, quotas: { cursor: cursorQuota } });
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: 'Cursor' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await expect(page.getByText('CSV export needs recorded token history from Claude Code or Codex.')).toContainText('Cursor token history is not recorded locally');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const exported = JSON.parse(await lastExport(page, 'json')).providers[0];
  expect(exported).toMatchObject({ provider: 'cursor', quotas: 'unofficial', history: null, historyNote: 'Cursor token history is not recorded locally. Only the monthly allowance is available.' });
});

test('the not-affiliated note and version appear in Connections and Help', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByText(NOT_AFFILIATED)).toBeVisible();
  await expect(page.locator('.quick-help')).toContainText(/MeterLuma v\d+\.\d+\.\d+/);
  await expect(page.locator('.quick-help')).not.toContainText(/Internal beta|prototype/i);
});

test('official provider logos load, switch to their dark-background files in the dark theme, and live data does not tint the interface', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['claude', 'codex', 'cursor'], enabled: ['claude', 'codex', 'cursor'], theme: 'light' }, quotas: { codex: codexQuota, cursor: cursorQuota }, histories: { claude: history(), codex: history() } });
  await page.goto('/');
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.getByRole('progressbar', { name: 'Codex Session remaining' })).toBeVisible();
  // The mock returns the old terracotta brand color (#d97757); no interface element may be painted with it.
  const tinted = await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => { const style = getComputedStyle(element); return [style.color, style.backgroundColor, style.fill, style.stroke].includes('rgb(217, 119, 87)'); }).length);
  expect(tinted).toBe(0);
  // Only the logo for the current theme is displayed. Each must load, stay decorative and be the official file for that background,
  // identified by its ink: Claude's terracotta, OpenAI's black or white Blossom, and Cursor's two cube colors.
  const shown = () => page.locator('.quick-rail img.provider-brand').evaluateAll(images => Promise.all(images.filter(image => getComputedStyle(image).display !== 'none').map(async element => {
    const image = element as HTMLImageElement;
    const src = image.currentSrc || image.src;
    const markup = src.startsWith('data:') ? decodeURIComponent(src.slice(src.indexOf(',') + 1)) : await (await fetch(src)).text();
    // Vite inlines small SVGs with single-quoted attributes.
    const ink = markup.match(/fill(?:=["']|:\s*)(#[0-9a-f]{3,8}|black|white)/i)?.[1].toLowerCase();
    return { id: image.dataset.provider, ink, loaded: image.complete && image.naturalWidth > 0, decorative: image.alt === '' && image.getAttribute('aria-hidden') === 'true' };
  })));
  const expected = (variant: 'light' | 'dark') => [
    { id: 'claude', ink: '#d97757', loaded: true, decorative: true },
    { id: 'codex', ink: variant === 'light' ? 'black' : 'white', loaded: true, decorative: true },
    { id: 'cursor', ink: variant === 'light' ? '#26251e' : '#edecec', loaded: true, decorative: true },
  ];
  await expect.poll(shown).toEqual(expected('light'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(shown).toEqual(expected('dark'));
});

test('a render error shows a recoverable error screen instead of a blank panel', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: codexQuota }, malformedQuota: true });
  await page.goto('/');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Something went wrong.');
  await expect(alert).toContainText('Your settings and connections are unchanged.');
  const reload = page.waitForEvent('framenavigated');
  await alert.getByRole('button', { name: 'Reload' }).click();
  await reload;
  await expect(page.getByRole('alert')).toContainText('Something went wrong.');
});

test('third-party notices load on demand and render in pages', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meterluma.settings.v2', JSON.stringify({ demo: true })));
  const requested: string[] = [];
  // The dev server also serves a tiny `?import&url` module that only holds the file's URL; count real file fetches.
  page.on('request', request => { if (request.url().includes('THIRD_PARTY_NOTICES') && !request.url().includes('import')) requested.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'View license' }).click();
  const dialog = page.getByRole('dialog', { name: 'Free for personal use.' });
  expect(requested).toEqual([]);
  await dialog.getByText('Third-party licenses and source links').click();
  const viewer = dialog.getByRole('region', { name: 'Third-party notices' });
  await expect(viewer.locator('pre')).toHaveCount(1);
  expect(await viewer.evaluate(element => element.textContent!.length)).toBeLessThanOrEqual(200_000);
  await expect(dialog.getByRole('status')).toContainText(/Showing \d+ KB of [\d,]+ KB/);
  await dialog.getByRole('button', { name: 'Show more' }).click();
  await expect(viewer.locator('pre')).toHaveCount(2);
  expect(await viewer.evaluate(element => element.textContent!.length)).toBeLessThanOrEqual(400_000);
  expect(requested).toHaveLength(1);
});

test('tray panel errors clear when the user moves on', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false }, failResizeOnce: true });
  await page.goto('/');
  await expect(page.getByText('The panel could not be resized.')).toBeVisible();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByText('The panel could not be resized.')).toHaveCount(0);
});

test('cached quotas are never labeled live in details, the tray tooltip or Connections', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, liveProviders: ['cursor'], enabled: ['cursor'] }, quotas: { cursor: { error: { code: 'rate_limited', message: 'The provider is limiting requests.' }, retryIn: 3_600_000, snapshot: { plan: 'Pro', ageMs: 120_000, metrics: [{ label: 'Monthly', usedPercent: 40, resetIn: 86_400_000 }, { label: 'Expired window', usedPercent: 99, resetIn: -60_000 }] } } } });
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: 'Cursor' })).toContainText('Cached quotas');
  await page.getByRole('button', { name: 'Cursor details' }).click();
  await expect(page.locator('.quick-plan')).toHaveText('Cached quotas');
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Cached from/);
  await expect(page.locator('.quick-detail')).not.toContainText('Expired window');
  await expect(page.locator('.quick-detail')).not.toContainText('Resets in Reset due');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.locator('.quick-connection').filter({ hasText: 'Cursor' })).toContainText('Rate limited (cached)');
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.summary).toBe('Cursor 60% left (cached)');
});

test('the time format setting applies to every displayed time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T21:42:00Z') });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, demo: false, timeFormat: '24', liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: codexQuota }, histories: { codex: history() } });
  await page.goto('/');
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Updated 21:42/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: '12-hour', exact: true }).click();
  await page.getByRole('button', { name: 'Absolute', exact: true }).click();
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Updated 9:42 PM/);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.quick-metric-caption').first()).toContainText('Resets Oct 15, 10:42 PM');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.locator('.quick-data-note')).toContainText('Scanned 9:42 PM.');
  await expect(page.locator('.quick-update')).toHaveAttribute('title', /Fetched 9:42 PM/);
});

