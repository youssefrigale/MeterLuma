import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, nativeBridge, nativeCalls, countCalls } from './fixtures';

const locked = 'Saved connection is locked. Open Connections and choose Unlock saved connection.';
test('OpenCode offers an explained unlock action on Overview and its provider page instead of a futile retry', async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, theme: 'dark', liveProviders: [], enabled: [], additionalConnections: [{ id: 'opencode', label: 'OpenCode Go / Go Plus', consentVersion: 1 }] },
    additional: { opencode: { error: locked } },
  });
  await page.goto('/');
  const unlock = page.getByRole('button', { name: 'Unlock OpenCode Go / Go Plus saved connection' });
  await expect(unlock).toBeVisible();
  await page.getByRole('button', { name: 'OpenCode Go / Go Plus details', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('macOS Keychain needs permission');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await unlock.click();
  const dialog = page.getByRole('dialog', { name: 'Unlock OpenCode Go / Go Plus connection' });
  await expect(dialog).toContainText('Your Mac password stays with macOS.');
  expect((await new AxeBuilder({ page }).include('dialog').withRules(['color-contrast']).analyze()).violations).toEqual([]);
  expect(await countCalls(page, 'unlock_saved_connection')).toBe(0);
  const before = await countCalls(page, 'refresh_additional_provider');
  await dialog.getByRole('button', { name: 'Continue to Keychain' }).click();
  await expect(dialog).toBeHidden();
  expect((await nativeCalls(page)).find(call => call.command === 'unlock_saved_connection')?.args).toEqual({ connectionId: 'external-opencode' });
  await expect.poll(() => countCalls(page, 'refresh_additional_provider')).toBeGreaterThan(before);
  expect(await countCalls(page, 'forget_additional_provider')).toBe(0);
});

for (const provider of [
  { name: 'Codex', connectionId: 'codex', refresh: 'refresh_provider', additional: false },
  { name: 'DeepSeek', connectionId: 'external-deepseek', refresh: 'refresh_additional_provider', additional: true },
]) {
  test(`${provider.name} waits for an explained user action before requesting Keychain access`, async ({ page }) => {
    await nativeBridge(page, {
      settings: { legalVersion: LEGAL, liveProviders: provider.additional ? [] : ['codex'], tokenProviders: provider.additional ? [] : ['codex'], enabled: provider.additional ? [] : ['codex'], additionalConnections: provider.additional ? [{ id: 'deepseek', label: 'DeepSeek', consentVersion: 1 }] : [] },
      quotas: { codex: { error: locked } }, additional: { deepseek: { error: locked } },
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    if (provider.additional) await page.getByText('More providers', { exact: true }).click();
    const unlock = page.getByRole('button', { name: `Unlock ${provider.name} saved connection` });
    await expect(unlock).toBeVisible();
    expect(await countCalls(page, 'unlock_saved_connection')).toBe(0);
    await unlock.click();
    const dialog = page.getByRole('dialog', { name: `Unlock ${provider.name} connection` });
    await expect(dialog).toContainText('Your Mac password stays with macOS.');
    expect(await countCalls(page, 'unlock_saved_connection')).toBe(0);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    expect(await countCalls(page, 'unlock_saved_connection')).toBe(0);
    await unlock.click();
    const before = await countCalls(page, provider.refresh);
    await dialog.getByRole('button', { name: 'Continue to Keychain' }).click();
    await expect(dialog).toBeHidden();
    expect((await nativeCalls(page)).filter(call => call.command === 'unlock_saved_connection')).toEqual([{ command: 'unlock_saved_connection', args: { connectionId: provider.connectionId } }]);
    await expect.poll(() => countCalls(page, provider.refresh)).toBeGreaterThan(before);
    expect(await countCalls(page, 'forget_account_token')).toBe(0);
    expect(await countCalls(page, 'forget_additional_provider')).toBe(0);
  });
}

test('denying Keychain access keeps the saved connection and does not retry automatically', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], tokenProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: { error: locked } } });
  await page.addInitScript(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = async (command, args) => {
      const response = await invoke(command, args);
      if (command === 'unlock_saved_connection') throw 'Synthetic user denial';
      return response;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock Codex saved connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unlock Codex connection' });
  await dialog.getByRole('button', { name: 'Continue to Keychain' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Keychain access was not granted. Your saved connection is unchanged.');
  await expect(dialog.getByRole('button', { name: 'Continue to Keychain' })).toBeEnabled();
  expect(await countCalls(page, 'unlock_saved_connection')).toBe(1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect Codex', exact: true })).toBeVisible();
  expect(await countCalls(page, 'forget_account_token')).toBe(0);
});
