import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, SETTINGS_KEY, history, nativeBridge, countCalls } from './fixtures';

async function normalizedSettings(page: Page) {
  return page.evaluate(async () => { const path = '/src/model.ts'; return (await import(path) as typeof import('../src/model')).readSettings(); });
}
test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
const quotas = {
  claude: { metrics: [{ label: 'Session', usedPercent: 24, resetIn: 3_600_000 }, { label: 'Weekly', usedPercent: 14, resetIn: 4 * 86_400_000 }, { label: 'A very long model-specific weekly allowance', usedPercent: 100, resetIn: 4 * 86_400_000 }] },
  codex: { metrics: [{ label: 'Weekly', usedPercent: .04, resetIn: 86_400_000 }] },
};

test('existing and newly connected overview cards start collapsed, including unavailable providers', async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'], collapsedCards: ['core:codex:codex'], additionalConnections: [{ id: 'opencode', label: 'OpenCode', consentVersion: 1 }] },
    quotas: { codex: quotas.codex }, additional: { opencode: { error: 'Saved connection is locked.' }, deepseek: { amounts: [{ label: 'Balance', value: 3, currency: 'USD', unit: '' }] } },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Expand Codex overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Expand OpenCode Go / Go Plus · OpenCode overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Expand Codex overview card', exact: true }).click();
  await page.evaluate(key => {
    const settings = JSON.parse(localStorage.getItem(key)!);
    settings.additionalConnections.push({ id: 'deepseek', label: 'DeepSeek', consentVersion: 1 });
    localStorage.setItem(key, JSON.stringify(settings));
  }, SETTINGS_KEY);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse Codex overview card', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Expand DeepSeek overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

for (const theme of ['dark', 'light'] as const) test(`${theme} expanded Overview fits long OpenCode account headings inside the popup`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude', 'codex'], expandedCards: ['core:claude:claude', 'core:codex:codex', 'additional:opencode'], theme, additionalConnections: [{ id: 'opencode', label: 'OpenCode Go / Go Plus · Work account', consentVersion: 1 }] },
    quotas: { claude: { error: { code: 'sign_in_required', message: 'Your Claude Code sign-in has expired. Open Claude Code to renew it, then refresh here.' } }, codex: { metrics: [{ label: 'Weekly', usedPercent: 27, resetIn: 5 * 86_400_000 }] } },
    histories: { claude: history(), codex: history() },
    additional: { opencode: { name: 'OpenCode Go', metrics: [{ label: 'Session', usedPercent: 0, resetAt: null }, { label: 'Weekly', usedPercent: 15, resetAt: null }, { label: 'Monthly', usedPercent: 10, resetAt: null }], notice: 'Account-wide Go limits reported by OpenCode. Zen balances and local request history are not included in this connection.' } },
  });
  await page.goto('/');
  await expect(page.getByRole('article', { name: 'OpenCode Go / Go Plus usage' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'OpenCode Go / Go Plus Monthly remaining' })).toHaveAttribute('aria-valuenow', '90');
  const horizontalOverflow = () => page.locator('.quick-scroll').evaluate(element => element.scrollWidth - element.clientWidth);
  await expect.poll(horizontalOverflow).toBeLessThanOrEqual(1);
  const scrollRight = await page.locator('.quick-scroll').evaluate(element => element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight));
  for (const meter of await page.getByRole('progressbar').all()) {
    const bounds = (await meter.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(scrollRight + 1);
  }
  await page.screenshot({ path: testInfo.outputPath(`expanded-overview-${theme}.png`) });
  await page.getByRole('button', { name: /^Collapse OpenCode Go/ }).click();
  await expect.poll(horizontalOverflow).toBeLessThanOrEqual(1);
});

for (const theme of ['dark', 'light'] as const) test(`${theme} compact cards keep every meter and accessible reset text without changing the detail view`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude', 'codex'], expandedCards: ['core:claude:claude', 'core:codex:codex'], theme }, quotas, histories: { claude: history(), codex: history() } });
  await page.goto('/');
  const claude = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Claude', exact: true }) });
  await expect(claude.getByRole('progressbar')).toHaveCount(3);
  const before = (await claude.boundingBox())!.height;
  const requests = await countCalls(page, 'refresh_provider');
  await page.getByRole('button', { name: 'Collapse Claude overview card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Claude overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await claude.boundingBox())!.height).toBeLessThan(before - 50);
  await expect(claude.getByRole('progressbar')).toHaveCount(3);
  const exhausted = claude.getByRole('progressbar', { name: 'Claude A very long model-specific weekly allowance remaining', exact: true });
  await expect(exhausted).toBeVisible(); await expect(exhausted).toHaveAttribute('aria-valuenow', '0');
  await expect(exhausted).toHaveAttribute('aria-valuetext', /0% left\. Resets in/);
  await expect(claude.getByRole('heading', { name: 'A very long model-specific weekly allowance', exact: true })).toHaveAttribute('title', 'A very long model-specific weekly allowance');
  await page.getByRole('button', { name: 'Collapse Codex overview card', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Codex Weekly remaining', exact: true })).toHaveAttribute('aria-valuetext', />99.9% left/);
  expect(await countCalls(page, 'refresh_provider')).toBe(requests);
  expect(await page.locator('.quick-view').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`collapsed-overview-${theme}.png`) });
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect(page.getByRole('button', { name: /overview card/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Usage dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Claude overview card', exact: true })).toBeVisible();
});

test('expansion is scoped to each connection and survives reload and keyboard collapse', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'], profiles: [{ key: 'work', providerId: 'codex', label: 'Work', directory: '/synthetic/work' }] }, quotas: { codex: quotas.codex }, histories: { codex: history() } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Expand Codex · Work overview card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Codex · Default profile overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect((await normalizedSettings(page)).expandedCards).toEqual(['core:codex:work']);
  await page.reload();
  const collapse = page.getByRole('button', { name: 'Collapse Codex · Work overview card', exact: true });
  await expect(collapse).toBeVisible(); await collapse.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Expand Codex · Work overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect((await normalizedSettings(page)).expandedCards).toEqual([]);
});

test('collapsed additional cards preserve currency units and cached warnings, and expired cached meters disappear', async ({ page }, testInfo) => {
  const now = new Date('2026-10-27T10:00:00Z'); await page.clock.setFixedTime(now);
  await page.setViewportSize({ width: 360, height: 660 });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], theme: 'dark', additionalConnections: [{ id: 'zed', label: 'Zed', consentVersion: 1 }, { id: 'deepseek', label: 'Separate currencies', consentVersion: 1 }] }, additional: {
    zed: { name: 'Zed', cached: true, fetchedAt: now.getTime(), metrics: [{ label: 'Edit predictions', usedPercent: 20, resetAt: now.getTime() + 60_000 }] },
    deepseek: { amounts: [{ label: 'Balance', value: 0, currency: 'USD', unit: '' }, { label: 'Balance', value: 8, currency: 'CNY', unit: '' }] },
  } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Expand Zed overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Expand DeepSeek · Separate currencies overview card', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('progressbar', { name: 'Cached Zed Edit predictions remaining', exact: true })).toHaveAttribute('aria-valuenow', '80');
  await expect(page.getByRole('article', { name: 'Zed usage' })).toContainText('Cached usage from');
  await expect(page.getByRole('region', { name: 'DeepSeek reported amounts' })).toContainText('USD 0.00');
  await expect(page.getByRole('region', { name: 'DeepSeek reported amounts' })).toContainText('CNY 8.00');
  await page.screenshot({ path: testInfo.outputPath('collapsed-additional.png') });
  await page.clock.setFixedTime(new Date(now.getTime() + 61_000));
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Zed usage' }).getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Zed usage' })).toContainText('Cached usage from');
  expect((await normalizedSettings(page)).expandedCards).toEqual([]);
});

test('a cached core card stays labeled and faded when collapsed', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude'], enabled: ['claude'], expandedCards: [] }, quotas: { claude: { error: { code: 'rate_limited', message: 'Usage requests are rate limited.' }, retryIn: 60_000, snapshot: quotas.claude } }, histories: { claude: history() } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Expand Claude overview card', exact: true })).toBeVisible();
  const meter = page.getByRole('progressbar', { name: 'Cached Claude Session remaining', exact: true });
  await expect(meter).toHaveAttribute('aria-valuenow', '76');
  await expect(page.getByText(/Cached quotas from/)).toBeVisible();
  expect(await meter.locator(':scope > span').evaluate(span => Number(getComputedStyle(span).opacity))).toBeLessThan(1);
});

test('layout-only reset and undo preserve connection, visibility, appearance, density and notification choices', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'], expandedCards: ['core:codex:codex'], providerOrder: ['cursor', 'codex', 'claude'], trayMetric: 'weekly', compactOverview: true, refreshMinutes: 15, theme: 'dark', remaining: false, timeFormat: '24', notifications: { enabled: false, low: false, thresholds: true, pace: false, resetMinutes: 60 }, alerts: [{ key: 'keep', providerId: 'codex', threshold: 80, enabled: true }] }, quotas: { codex: quotas.codex }, histories: { codex: history() } });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const before = await normalizedSettings(page);
  await page.getByRole('button', { name: 'Restore overview layout', exact: true }).click();
  expect(await normalizedSettings(page)).toEqual({ ...before, expandedCards: [], providerOrder: ['claude', 'codex', 'cursor'], trayMetric: 'session' });
  await expect(page.getByRole('button', { name: 'Restore overview layout', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'light theme', exact: true }).click();
  await page.getByRole('button', { name: 'Undo overview layout reset', exact: true }).click();
  expect(await normalizedSettings(page)).toEqual({ ...before, theme: 'light' });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse Codex overview card', exact: true })).toBeVisible();
});

test('failed storage keeps the card and layout unchanged without showing a successful reset', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'], expandedCards: ['core:codex:codex'], trayMetric: 'weekly' }, quotas: { codex: quotas.codex }, histories: { codex: history() } });
  await page.goto('/');
  const before = await normalizedSettings(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, contents) { if (name === key) throw new DOMException('Synthetic storage full', 'QuotaExceededError'); original.call(this, name, contents); };
  }, SETTINGS_KEY);
  await page.getByRole('button', { name: 'Collapse Codex overview card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse Codex overview card', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Your settings could not be saved on this device.')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restore overview layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo overview layout reset', exact: true })).toHaveCount(0);
  await expect(page.getByText('Overview cards collapsed, provider order and menu bar allowance restored.')).toHaveCount(0);
  expect(await normalizedSettings(page)).toEqual(before);
});

test('saved expansion keys are bounded, scoped and exclude paths, labels and unknown providers', async ({ page }) => {
  const valid = Array.from({ length: 90 }, (_, index) => `core:codex:profile_${index}`);
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: [], enabled: [], expandedCards: [...valid, valid[89], 'core:unknown:id', 'core:codex:/private/path', 'core:codex:key\n', 'additional:duckai', 'additional:unknown', { label: 'PRIVATE_LABEL' }, 'additional:zed'] } });
  await page.goto('/');
  const keys = (await normalizedSettings(page)).expandedCards!;
  expect(keys).toHaveLength(80); expect(keys[0]).toBe('core:codex:profile_11'); expect(keys.at(-1)).toBe('additional:zed');
  expect(new Set(keys).size).toBe(keys.length); expect(keys.join(' ')).not.toMatch(/private|unknown|duckai|\n/);
});

test('Mac height shrinks and grows with card disclosure while the footer stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 440 });
  await page.exposeFunction('resizeNativePanel', async (height: number) => page.setViewportSize({ width: 360, height: Math.min(1000, height) }));
  await nativeBridge(page, { settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude', 'codex'], expandedCards: ['core:claude:claude', 'core:codex:codex'] }, quotas, histories: { claude: history(), codex: history() } });
  await page.goto('/');
  await expect(page.getByRole('progressbar')).toHaveCount(4);
  await expect.poll(() => page.viewportSize()!.height).toBeGreaterThan(440);
  const expanded = page.viewportSize()!.height;
  await page.getByRole('button', { name: 'Collapse Claude overview card', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Codex overview card', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBeLessThan(expanded);
  const collapsed = page.viewportSize()!.height;
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Expand Claude overview card', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBeGreaterThan(collapsed);
});
