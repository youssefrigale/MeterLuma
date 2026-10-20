import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { activeAlerts } from '../src/Alerts';
import { usageCsv } from '../src/exportUsage';
import type { Provider } from '../src/model';

async function bridge(page: Page, accepted = true) {
  await page.addInitScript(({ accepted }) => {
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify({ legalVersion: accepted ? '1.1-providers-5' : '', demo: false, liveProviders: ['codex'], enabled: ['codex'] }));
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    Object.assign(window, { isTauri: true, featureCalls: calls, __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === 'validate_profile') return args.directory;
      if (command === 'save_usage_export') return true;
      if (command === 'refresh_provider' && args.providerId === 'claude') throw new Error('Claude quotas must never be requested');
      if (command === 'refresh_provider') return { id: 'codex', name: 'Codex', plan: 'Subscription', color: '#515157', initials: '', spendToday: null, fetchedAt: Date.now(), metrics: [{ label: 'Session', usedPercent: args.configDirectory ? 95 : 25, resetAt: Date.now() + 3600000 }] };
      if (command === 'read_usage_history') {
        const period = Number(args.days ?? 30);
        const days = Array.from({ length: period }, (_, index) => ({ date: new Date(Date.UTC(2026, 9, 15 - period + 1 + index)).toISOString().slice(0, 10), inputTokens: 80, cachedInputTokens: 20, cacheWriteTokens: 0, outputTokens: 20, totalTokens: 100, estimatedCostUsd: null, unpricedTokens: 0 }));
        return { available: true, partial: false, recordCount: period, scannedAt: Date.now(), today: '2026-10-15', periodDays: period, coverageStart: days[0].date,
          days,
          models: [{ name: args.configDirectory ? 'second-profile-model' : 'default-profile-model', totalTokens: period * 100 }],
        };
      }
    } } });
  }, { accepted });
}

test('native data stays unread until the user accepts license and privacy information', async ({ page }) => {
  await bridge(page, false);
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Before you connect' });
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('button', { name: 'Agree and continue' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { featureCalls: { command: string }[] }).featureCalls.filter(call => ['refresh_provider', 'read_usage_history'].includes(call.command)).length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(gate).toBeVisible();
  await gate.getByRole('checkbox').check();
  await gate.getByRole('button', { name: 'Agree and continue' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.reload();
  await expect(gate).not.toBeVisible();
});

test('longer history changes the native request, recorded totals and exported data', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Recorded history window').selectOption('365');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.locator('.usage-history')).toContainText('Last 365 days');
  await expect(page.getByRole('img', { name: 'Recorded token usage over 365 days: 36,500 tokens' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const json = await page.evaluate(() => {
    const calls = (window as unknown as { featureCalls: { command: string; args: { format?: string; content?: string } }[] }).featureCalls;
    return calls.filter(call => call.command === 'save_usage_export' && call.args.format === 'json').at(-1)?.args.content ?? '';
  });
  const data = JSON.parse(json);
  expect(data.providers[0].history.days).toHaveLength(365);
  expect(data.mode).toBe('live');
  expect(json).not.toMatch(/accessToken|auth\.json|configDirectory|conversation/);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
});

test('separate local accounts remain isolated and can be removed', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByLabel('Account label', { exact: true }).fill('Second personal account');
  await page.getByLabel('Local profile directory', { exact: true }).fill('C:/Users/example/.codex-second');
  await page.getByRole('button', { name: 'Add local account' }).click();
  await expect(page.getByRole('button', { name: 'Remove Second personal account' })).toBeVisible();
  await expect(page.locator('.quick-connection').filter({ hasText: 'Codex' })).toContainText('Connected');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').filter({ hasText: 'Second personal account' })).toContainText('5% left');
  await expect(page.getByRole('article').filter({ hasText: 'Default profile' })).toContainText('75% left');
  await page.getByRole('button', { name: 'Codex details' }).click();
  await page.getByLabel('Local account').selectOption({ label: 'Second personal account' });
  await expect(page.locator('.usage-history')).toContainText('second-profile-model');
  await expect(page.locator('.usage-history')).not.toContainText('default-profile-model');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Second personal account' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('custom alert settings persist and warn on fresh quotas', async ({ page }) => {
  await bridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Alert at % used').fill('20');
  await page.getByRole('button', { name: 'Add alert', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Codex · 20% used' })).toBeChecked();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const alerts = page.getByRole('region', { name: 'Usage alerts' });
  await expect(alerts).toContainText('Session is 25% used (alert at 20%).');
  await alerts.getByRole('button', { name: /Dismiss/ }).click();
  await expect(alerts).not.toBeVisible();
});

test('alerts exclude demo, stale or expired quotas and CSV neutralizes formula labels', () => {
  const now = Date.now();
  const provider: Provider = { id: 'codex', name: 'Codex', plan: 'Subscription', initials: '', color: '#000', spendToday: null, fetchedAt: now, accountLabel: '=HYPERLINK("https://example.test")', metrics: [{ label: 'Session', usedPercent: 95, resetAt: now + 60000 }], history: { available: true, partial: true, recordCount: 1, scannedAt: now, today: '2026-10-15', coverageStart: '2026-10-15', days: [{ date: '2026-10-14', inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: null, unpricedTokens: 0 }, { date: '2026-10-15', inputTokens: 80, cachedInputTokens: 20, cacheWriteTokens: 0, outputTokens: 20, totalTokens: 100, estimatedCostUsd: null, unpricedTokens: 0 }], models: [] } };
  const rules = [{ key: 'rule', providerId: 'codex' as const, enabled: true, threshold: 80 }];
  expect(activeAlerts(rules, [provider], now, false)).toHaveLength(1);
  expect(activeAlerts(rules, [provider], now, true)).toHaveLength(0);
  expect(activeAlerts(rules, [provider], now + 11 * 60000, false)).toHaveLength(0);
  expect(activeAlerts(rules, [{ ...provider, metrics: [{ ...provider.metrics[0], resetAt: now - 1 }] }], now, false)).toHaveLength(0);
  const csv = usageCsv([provider], false);
  expect(csv).toContain('"\'=HYPERLINK');
  expect(csv).toContain('"true"');
  expect(csv).not.toContain('configDirectory');
  // The unrecorded day keeps formula protection and has empty values rather than zeros.
  expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")","2026-10-14","false","","","","","","","",');
  expect(csv).toContain('"2026-10-15","true","80","20","0","20","100","0","",');
});
