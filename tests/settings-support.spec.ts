import { test, expect, type Page } from '@playwright/test';
import { LEGAL, SETTINGS_KEY, nativeBridge, nativeCalls, history, countCalls } from './fixtures';

const preferences = { theme: 'dark', remaining: true, refreshMinutes: 15, enabled: ['claude', 'codex'], resetStyle: 'relative', timeFormat: '24', providerOrder: ['codex', 'claude', 'cursor'], historyDays: 90, pacing: true, compactOverview: true, trayMetric: 'weekly' };
const preferenceDocument = (patch = {}) => JSON.stringify({ kind: 'MeterLumaPreferences', formatVersion: 1, preferences: { ...preferences, ...patch } });
const savedSettings = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY);
async function supportExport(page: Page, kind: string) {
  return (await nativeCalls(page)).filter(call => call.command === 'save_support_export' && call.args.kind === kind).at(-1)!.args.content as string;
}

test('preferences export round-trips with preview, cancellation and undo while connections stay intact', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 660 });
  const privateSettings = { additionalProviderOrder: ['zed', 'deepseek'], expandedCards: ['core:codex:codex'], notifications: { enabled: false, low: false, thresholds: true, pace: true, resetMinutes: 60 }, legalVersion: LEGAL, claudeLive: true, liveProviders: ['codex'], tokenProviders: ['codex'], ignoredLocalProviders: ['cursor'], profiles: [{ key: 'private_profile', providerId: 'claude', label: 'PRIVATE_ACCOUNT', directory: '/private/PRIVATE_PATH', paused: true }], alerts: [{ key: 'threshold_rule', providerId: 'codex', threshold: 80, enabled: true }], additionalConnections: [{ id: 'deepseek', label: 'PRIVATE_LABEL', consentVersion: 1, enabled: false }] };
  await nativeBridge(page, { settings: { ...preferences, ...privateSettings }, quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 10, resetIn: 3_600_000 }] } } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('desktop-controls.png') });
  await page.getByRole('button', { name: 'Export preferences', exact: true }).click();
  const backup = await supportExport(page, 'preferences');
  expect(JSON.parse(backup).preferences).toEqual(preferences);
  expect(backup).not.toMatch(/PRIVATE_|legalVersion|claudeLive|liveProviders|tokenProviders|ignoredLocalProviders|profiles|alerts|additionalConnections|notifications|expandedCards|additionalProviderOrder/);
  await page.getByRole('button', { name: 'light theme' }).click();
  await page.getByRole('button', { name: 'Used', exact: true }).click();
  const before = await savedSettings(page);
  await page.evaluate(text => Object.assign(window, { preferenceImport: text }), '\uFEFF' + backup);
  await page.getByRole('button', { name: 'Import preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import display preferences?' });
  await expect(dialog).toContainText('Appearance'); await expect(dialog).toContainText('Usage mode');
  await page.screenshot({ path: testInfo.outputPath('preferences-import.png') });
  expect(await savedSettings(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await savedSettings(page)).toEqual(before);
  await page.getByRole('button', { name: 'Import preferences', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply preferences', exact: true }).click();
  expect(await savedSettings(page)).toMatchObject({ ...preferences, ...privateSettings });
  await page.getByRole('button', { name: 'Undo preference import', exact: true }).click();
  expect(await savedSettings(page)).toEqual(before);
  expect(await countCalls(page, 'connect_account_token')).toBe(0);
  expect(await countCalls(page, 'connect_additional_provider')).toBe(0);
  await page.reload();
  expect(await savedSettings(page)).toEqual(before);
});

for (const [name, file] of [
  ['empty', ''], ['wrong version', preferenceDocument().replace('"formatVersion":1', '"formatVersion":2')],
  ['invalid choice', preferenceDocument({ theme: 'neon' })], ['coerced number', preferenceDocument({ refreshMinutes: '15' })],
  ['duplicate provider', preferenceDocument({ providerOrder: ['codex', 'codex', 'cursor'] })],
  ['additional order injection', preferenceDocument({ additionalProviderOrder: ['deepseek'] })],
  ['card identity injection', preferenceDocument({ expandedCards: ['core:codex:codex'] })],
  ['notification injection', preferenceDocument({ notifications: { enabled: true } })],
  ['connection injection', preferenceDocument({ liveProviders: ['cursor'], claudeLive: true })],
  ['prototype key', preferenceDocument().replace('"preferences":{', '"preferences":{"__proto__":{"polluted":true},')],
  ['oversized UTF-8', 'é'.repeat(40_000)],
]) test(`a ${name} preference file cannot change saved settings`, async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, preferenceImport: file });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const before = await savedSettings(page);
  await page.getByRole('button', { name: 'Import preferences', exact: true }).click();
  await expect(page.getByText('Choose a valid MeterLuma preferences JSON file, up to 64 KiB. No settings were changed.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await savedSettings(page)).toEqual(before);
});

for (const response of ['cancel', 'fail'] as const) test(`a ${response} preferences export does not claim a saved file`, async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, supportExport: response });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Export preferences', exact: true }).click();
  await expect(page.getByText(response === 'cancel' ? 'Export cancelled.' : 'Preferences could not be saved. Try exporting again.')).toBeVisible();
});

test('diagnostics contain bounded lookup outcomes without account data, errors or usage values', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, enabled: ['codex', 'cursor'], liveProviders: ['codex', 'cursor'], profiles: [{ key: 'PRIVATE_KEY', providerId: 'codex', label: 'PRIVATE_ACCOUNT', directory: '/private/PRIVATE_PATH' }], additionalConnections: [{ id: 'deepseek', label: 'PRIVATE_LABEL', consentVersion: 1 }] },
    quotas: { codex: { plan: 'PRIVATE_PLAN', metrics: [{ label: 'PRIVATE_QUOTA', usedPercent: 94, resetIn: 3_600_000 }] }, cursor: { error: { code: 'sign_in_required', message: 'PRIVATE_ERROR token=PRIVATE_TOKEN' } } },
    histories: { codex: history({ tokens: 7654321, models: [{ name: 'PRIVATE_MODEL', share: 1 }] }) },
    additional: { deepseek: { amounts: [{ label: 'PRIVATE_AMOUNT', value: 874321.11, currency: 'USD', unit: '' }], notice: 'PRIVATE_RESPONSE' } },
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Refresh usage', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click();
  const first = await supportExport(page, 'diagnostics'); const report = JSON.parse(first);
  await page.getByText('Preview diagnostics', { exact: true }).click();
  await page.locator('.diagnostic-tools').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('diagnostics-preview.png') });
  expect(first).not.toMatch(/PRIVATE_|7654321|874321|configDirectory|accountLabel|accessToken/);
  expect(report.core).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'cursor', quotaState: 'sign_in_required' })]));
  expect(report.lookups.length).toBeGreaterThan(0);
  expect(report.lookups.every((lookup: { durationMs: number | null }) => typeof lookup.durationMs === 'number' && lookup.durationMs >= 0)).toBe(true);
  await page.evaluate(async () => {
    const modulePath = '/src/nativeLookup.ts';
    const { nativeLookup } = await import(modulePath) as typeof import('../src/nativeLookup');
    await Promise.all(Array.from({ length: 25 }, () => nativeLookup('refresh_provider', { providerId: 'PRIVATE_UNKNOWN_PROVIDER', configDirectory: '/PRIVATE_PATH' }).catch((reason: unknown) => {
      if (reason !== 'Unexpected quota request') throw reason;
    })));
  });
  await page.getByRole('button', { name: 'Refresh diagnostics', exact: true }).click();
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click();
  const bounded = await supportExport(page, 'diagnostics');
  expect(JSON.parse(bounded).lookups).toHaveLength(20);
  expect(JSON.parse(bounded).lookups.every((lookup: { provider: string; outcome: string }) => lookup.provider === 'unknown' && lookup.outcome === 'unavailable')).toBe(true);
  expect(bounded).not.toContain('PRIVATE_');
  await page.getByRole('button', { name: 'Clear diagnostic history', exact: true }).click();
  await page.getByRole('button', { name: 'Export diagnostics', exact: true }).click();
  expect(JSON.parse(await supportExport(page, 'diagnostics')).lookups).toEqual([]);
});

for (const initiallyEnabled of [false, true]) test(`start at login reads the system's ${initiallyEnabled ? 'enabled' : 'disabled'} state and changes only on request`, async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, startupEnabled: initiallyEnabled });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const startup = page.getByRole('checkbox', { name: 'Open MeterLuma when you log in', exact: true });
  await expect(startup).toBeEnabled(); await expect(startup).toBeChecked({ checked: initiallyEnabled });
  expect(await countCalls(page, 'set_startup_enabled')).toBe(0);
  await startup.click(); await expect(startup).toBeChecked({ checked: !initiallyEnabled });
  expect((await nativeCalls(page)).find(call => call.command === 'set_startup_enabled')!.args).toEqual({ enabled: !initiallyEnabled });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(startup).toBeChecked({ checked: !initiallyEnabled });
  await page.getByRole('button', { name: 'Export preferences', exact: true }).click();
  expect(await supportExport(page, 'preferences')).not.toMatch(/startup|autostart/i);
});

for (const failure of ['read', 'write'] as const) test(`a login setting ${failure} failure is explicit and does not invent an enabled state`, async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, startupError: failure });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const startup = page.getByRole('checkbox', { name: 'Open MeterLuma when you log in', exact: true });
  if (failure === 'read') { await expect(startup).toBeDisabled(); await expect(page.getByRole('button', { name: 'Check login setting again', exact: true })).toBeVisible(); }
  else { await expect(startup).toBeEnabled(); await startup.click(); await expect(startup).not.toBeChecked(); await expect(page.getByText('The system login setting could not be changed. Check permissions and try again.')).toBeVisible(); }
});

test('a custom panel shortcut is opt-in, survives imports and reloads, and can be removed', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, preferenceImport: preferenceDocument() });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await countCalls(page, 'set_panel_shortcut')).toBe(0);
  await page.getByRole('combobox', { name: 'Shortcut modifiers' }).selectOption('Alt');
  await page.getByRole('textbox', { name: 'Shortcut letter' }).fill('k');
  await page.getByRole('button', { name: 'Apply shortcut', exact: true }).click();
  await expect(page.getByText('Active: Command / Ctrl+Alt+K', { exact: true })).toBeVisible();
  expect((await savedSettings(page)).panelShortcut).toBe('CommandOrControl+Alt+K');
  await page.getByRole('button', { name: 'Import preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Apply preferences', exact: true }).click();
  expect((await savedSettings(page)).panelShortcut).toBe('CommandOrControl+Alt+K');
  await page.getByRole('button', { name: 'Export preferences', exact: true }).click();
  expect(await supportExport(page, 'preferences')).not.toContain('panelShortcut');
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Active: Command / Ctrl+Alt+K', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove shortcut', exact: true }).click();
  await expect(page.getByText('No keyboard shortcut is active.')).toBeVisible();
  expect((await savedSettings(page)).panelShortcut).toBeUndefined();
});

test('a conflicting panel shortcut keeps the working key and reports the conflict', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], panelShortcut: 'CommandOrControl+Shift+M' }, shortcutConflict: 'CommandOrControl+Shift+K' });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Active: Command / Ctrl+Shift+M', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Shortcut letter' }).fill('K');
  await page.getByRole('button', { name: 'Apply shortcut', exact: true }).click();
  await expect(page.getByText('This shortcut could not be registered. Choose another combination.')).toBeVisible();
  expect((await savedSettings(page)).panelShortcut).toBe('CommandOrControl+Shift+M');
  await expect(page.getByRole('button', { name: 'Remove shortcut', exact: true })).toBeVisible();
});

test('restoring a saved shortcut cannot overwrite preferences changed while native registration is pending', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], theme: 'dark', panelShortcut: 'CommandOrControl+Shift+M' }, holdShortcut: true });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => countCalls(page, 'set_panel_shortcut')).toBe(1);
  await page.getByRole('button', { name: 'light theme', exact: true }).click();
  const updated = await savedSettings(page);
  await page.evaluate(() => (window as unknown as { releaseNative: () => void }).releaseNative());
  await expect(page.getByText('Active: Command / Ctrl+Shift+M', { exact: true })).toBeVisible();
  expect(await savedSettings(page)).toEqual(updated);
});

for (const failed of [false, true]) test(`keep panel open ${failed ? 'reports a native failure' : 'changes only on request and remains set across navigation'}`, async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, panelError: failed });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const pinned = page.getByRole('checkbox', { name: 'Keep usage visible above other apps', exact: true });
  await expect(pinned).toBeEnabled(); await expect(pinned).not.toBeChecked();
  expect(await countCalls(page, 'set_panel_pinned')).toBe(0);
  await pinned.click(); await expect(pinned).toBeChecked({ checked: !failed });
  if (failed) await expect(page.getByText('The panel setting could not be changed. Try again.')).toBeVisible();
  else {
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(pinned).toBeChecked();
    await page.getByRole('button', { name: 'Export preferences', exact: true }).click();
    expect(await supportExport(page, 'preferences')).not.toMatch(/pinned|panelPinned/i);
  }
});
