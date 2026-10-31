import { test, expect } from '@playwright/test';
import { LEGAL, SETTINGS_KEY, nativeBridge, nativeCalls, countCalls } from './fixtures';
import catalog from '../src/additional/catalog.json' with { type: 'json' };

const balance = { amounts: [{ label: 'Balance', value: 8.76, currency: 'CNY', unit: '' }] };
const connection = (id: string) => ({ id, label: id, enabled: true, consentVersion: 1 });

test('CLI readers require separate consent and unavailable providers never offer a tracking connection', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('More providers', { exact: true }).click();
  for (const provider of catalog.filter(provider => provider.source === 'cli')) {
    await page.getByRole('button', { name: `Connect ${provider.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Connect ${provider.name}` });
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await expect(dialog).toContainText('No model prompt is sent.');
    await expect(dialog.getByRole('button', { name: `Connect ${provider.name}` })).toBeDisabled();
    await page.keyboard.press('Escape');
  }
  await page.getByText('Other requested providers', { exact: true }).click();
  for (const provider of catalog.filter(provider => provider.state !== 'ready')) {
    await expect(page.getByRole('button', { name: `Connect ${provider.name}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Open ${provider.name} dashboard`, exact: true })).toBeVisible();
  }
  expect(await countCalls(page, 'connect_additional_provider')).toBe(0);
  expect(await countCalls(page, 'refresh_additional_provider')).toBe(0);
});

test('the footer countdown refreshes usage without changing provider connections', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], additionalConnections: [connection('deepseek')] }, additional: { deepseek: balance } });
  await page.goto('/');
  const refresh = page.getByRole('button', { name: 'Refresh now', exact: true });
  await expect(refresh).toBeEnabled();
  // Take the baseline after the startup lookups have rendered, so none of them can land after it.
  await expect(page.getByRole('article').filter({ hasText: 'DeepSeek' })).toContainText('8.76');
  const before = await countCalls(page, 'refresh_additional_provider');
  await refresh.click();
  await expect.poll(() => countCalls(page, 'refresh_additional_provider')).toBe(before + 1);
  expect(await countCalls(page, 'connect_additional_provider')).toBe(0);
});

for (const scope of [
  { id: 'gemini', name: 'Gemini CLI', tokenLabel: 'Gemini OAuth access token', fieldLabel: 'Cloud project ID', field: 'projectId' },
  { id: 'fireworks', name: 'Fireworks', tokenLabel: 'Fireworks API key', fieldLabel: 'Fireworks account ID', field: 'accountId' },
  { id: 'zed', name: 'Zed', tokenLabel: 'Zed access token', fieldLabel: 'Zed user ID', field: 'userId' },
]) {
  test(`${scope.name} keeps its token and routing ID out of preferences`, async ({ page }) => {
    await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, additional: { [scope.id]: balance } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    await page.getByText('More providers', { exact: true }).click();
    await page.getByRole('button', { name: `Connect ${scope.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Connect ${scope.name}` });
    await dialog.getByLabel(scope.tokenLabel, { exact: true }).fill('synthetic-scope-token');
    await dialog.getByRole('checkbox').check();
    await expect(dialog.getByRole('button', { name: `Connect ${scope.name}` })).toBeDisabled();
    await dialog.getByLabel(scope.fieldLabel, { exact: true }).fill('synthetic-scope-id');
    await dialog.getByRole('button', { name: `Connect ${scope.name}` }).click();
    await expect(dialog).toBeHidden();
    const request = (await nativeCalls(page)).find(call => call.command === 'connect_additional_provider');
    expect(JSON.parse(request!.args.token as string)).toEqual({ accessToken: 'synthetic-scope-token', [scope.field]: 'synthetic-scope-id' });
    const preferences = await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY);
    expect(preferences).not.toContain('synthetic-scope-token');
    expect(preferences).not.toContain('synthetic-scope-id');
  });
}

test('an additional provider requires its own consent and stores no key in preferences', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, additional: { deepseek: balance } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('More providers', { exact: true }).click();
  expect(await countCalls(page, 'refresh_additional_provider')).toBe(0);
  await page.getByRole('button', { name: 'Connect DeepSeek', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect DeepSeek' });
  await dialog.getByLabel('API key', { exact: true }).fill('synthetic-test-key');
  await expect(dialog.getByRole('button', { name: 'Connect DeepSeek' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Connect DeepSeek' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'DeepSeek details' }).click();
  await expect(page.getByRole('region', { name: 'DeepSeek reported amounts' })).toContainText('CNY 8.76');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status).toMatchObject({ provider: 'deepseek', value: 'CNY 8.76' });
  const preferences = await page.evaluate(key => localStorage.getItem(key), SETTINGS_KEY);
  expect(preferences).not.toContain('synthetic-test-key');
  expect(JSON.parse(preferences!).additionalConnections).toEqual([expect.objectContaining({ id: 'deepseek', consentVersion: 1 })]);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('More providers', { exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect DeepSeek', exact: true }).click();
  await expect(page.getByRole('button', { name: 'DeepSeek details' })).toHaveCount(0);
  expect(await countCalls(page, 'forget_additional_provider')).toBe(1);
});

test('failed key replacement clears the password and preserves the saved connection', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], additionalConnections: [connection('deepseek')] }, additional: { deepseek: balance }, additionalTokenError: 'The key cannot read usage.' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('More providers', { exact: true }).click();
  await page.getByRole('button', { name: 'Replace DeepSeek key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect DeepSeek' });
  await dialog.getByLabel('API key', { exact: true }).fill('synthetic-rejected-key');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Connect DeepSeek' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The key cannot read usage.');
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveValue('');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).additionalConnections, SETTINGS_KEY)).toEqual([connection('deepseek')]);
});

test('one malformed provider cannot hide valid quotas and reopening refreshes only after the interval', async ({ page }) => {
  const start = new Date('2026-10-27T12:00:00Z'); await page.clock.install({ time: start });
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], refreshMinutes: 5, additionalConnections: [connection('synthetic'), connection('deepseek')] },
    additional: { synthetic: { name: 'Synthetic', metrics: [{ label: 'Session', usedPercent: 20, resetAt: start.getTime() + 3_600_000 }] }, deepseek: { amounts: [] } },
  });
  await page.goto('/');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
  await expect(page.getByText('The provider returned an unsupported usage snapshot.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const before = await countCalls(page, 'refresh_additional_provider');
  await page.clock.setSystemTime(new Date(start.getTime() + 6 * 60_000));
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => countCalls(page, 'refresh_additional_provider')).toBe(before + 2);
  await page.getByRole('button', { name: 'Synthetic details' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
});

test('local-only providers require consent without a password and show token amounts', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] }, additional: { xal: { name: 'Xal', amounts: [{ label: 'Today', value: 135, currency: null, unit: 'tokens' }] } } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('More providers', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect Xal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Xal' });
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await expect(dialog).toContainText('No credentials are read and no network requests are made.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Connect Xal' }).click();
  await page.getByRole('button', { name: 'Xal details' }).click();
  await expect(page.getByRole('region', { name: 'Xal reported amounts' })).toContainText('135 tokens');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('many connected providers keep the Mac footer and settings reachable on a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 440 });
  const providers = catalog.filter(provider => provider.state === 'ready');
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], additionalConnections: providers.map(provider => connection(provider.id)) }, additional: Object.fromEntries(providers.map(provider => [provider.id, balance])) });
  await page.goto('/');
  await expect(page.locator('.quick-rail-providers button')).toHaveCount(providers.length);
  const last = page.getByRole('button', { name: `${providers.at(-1)!.name} details` });
  await last.scrollIntoViewIfNeeded(); await last.click();
  await expect(page.getByRole('heading', { name: providers.at(-1)!.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
