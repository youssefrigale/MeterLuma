import { test, expect, type Page, type Locator } from '@playwright/test';
import { LEGAL, SETTINGS_KEY, nativeBridge, countCalls } from './fixtures';
import catalog from '../src/additional/catalog.json' with { type: 'json' };

test.use({ viewport: { width: 360, height: 850 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY);
async function dragTo(page: Page, handle: Locator, row: Locator) {
  const start = await handle.boundingBox(); const end = await row.boundingBox();
  expect(start).not.toBeNull(); expect(end).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down(); await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 8 }); await page.mouse.up();
}
const coreNames = (page: Page) => page.getByRole('list', { name: 'Core providers' }).getByRole('heading').allTextContents();
async function setup(page: Page, settings: Record<string, unknown> = {}) {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude', 'codex', 'cursor'], enabled: ['claude', 'codex', 'cursor'], ...settings }, quotas: Object.fromEntries(['claude', 'codex', 'cursor'].map(id => [id, { metrics: [{ label: 'Session', usedPercent: 20, resetIn: 3_600_000 }] }])) });
  await page.goto('/'); await page.getByRole('button', { name: 'Connections', exact: true }).click();
}

for (const theme of ['dark', 'light']) test(`${theme} core logos have no frames and pointer reordering persists into the sidebar and Overview`, async ({ page }, testInfo) => {
  await setup(page, { theme });
  const frames = await page.locator('.quick-connection-logo').evaluateAll(elements => elements.map(element => ({ border: getComputedStyle(element).borderTopWidth, background: getComputedStyle(element).backgroundColor })));
  expect(frames).toEqual(Array(3).fill({ border: '0px', background: 'rgba(0, 0, 0, 0)' }));
  const codex = page.locator('.quick-connection-logo [data-provider="codex"]:visible');
  await expect(codex).toHaveCSS('transform', 'none'); await expect(codex).toHaveCSS('width', '56px');
  const mark = await codex.boundingBox(); const slot = await codex.locator('..').boundingBox();
  expect(Math.abs(mark!.x + mark!.width / 2 - slot!.x - slot!.width / 2)).toBeLessThan(1);
  expect(Math.abs(mark!.y + mark!.height / 2 - slot!.y - slot!.height / 2)).toBeLessThan(1);
  await dragTo(page, page.getByRole('button', { name: 'Reorder Cursor', exact: true }), page.locator('[data-reorder-id="claude"]'));
  expect((await saved(page)).providerOrder).toEqual(['cursor', 'claude', 'codex']);
  expect(await coreNames(page)).toEqual(['Cursor', 'Claude', 'Codex']);
  await page.screenshot({ path: testInfo.outputPath(`core-logos-${theme}.png`) });
  await page.reload(); await page.getByRole('button', { name: 'Connections', exact: true }).click();
  expect(await coreNames(page)).toEqual(['Cursor', 'Claude', 'Codex']);
  expect(await page.locator('.quick-rail-providers button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Cursor details', 'Claude details', 'Codex details']);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  expect(await page.locator('.quick-providers > article h2').allTextContents()).toEqual(['Cursor', 'Claude', 'Codex']);
});

test('additional provider dragging changes display order without refreshing or changing connections', async ({ page }) => {
  const connections = ['amp', 'antigravity', 'deepseek'].map(id => ({ id, label: id, consentVersion: 1, enabled: true }));
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], additionalConnections: connections }, additional: Object.fromEntries(connections.map(connection => [connection.id, { amounts: [{ label: 'Balance', value: 1, currency: 'USD', unit: '' }] }])) });
  await page.goto('/'); await page.getByRole('button', { name: 'Connections', exact: true }).click(); await page.getByText('More providers', { exact: true }).click();
  const beforeReads = await countCalls(page, 'refresh_additional_provider');
  await page.locator('.additional-connections').evaluate(element => element.scrollIntoView());
  await dragTo(page, page.getByRole('button', { name: 'Reorder Antigravity', exact: true }), page.locator('[data-reorder-id="amp"]'));
  const preferences = await saved(page);
  expect(preferences.additionalProviderOrder.indexOf('antigravity')).toBeLessThan(preferences.additionalProviderOrder.indexOf('amp'));
  expect(preferences.additionalConnections).toEqual(connections);
  expect(await countCalls(page, 'refresh_additional_provider')).toBe(beforeReads);
  expect(await countCalls(page, 'connect_additional_provider')).toBe(0); expect(await countCalls(page, 'forget_additional_provider')).toBe(0);
  expect(await page.locator('.quick-rail-providers button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Antigravity details', 'Amp details', 'DeepSeek details']);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  expect(await page.locator('.quick-providers > article').evaluateAll(articles => articles.map(article => article.getAttribute('aria-label')))).toEqual(['Antigravity usage', 'Amp usage', 'DeepSeek usage']);
  await page.reload(); await page.getByRole('button', { name: 'Connections', exact: true }).click(); await page.getByText('More providers', { exact: true }).click();
  expect((await saved(page)).additionalProviderOrder).toEqual(preferences.additionalProviderOrder);
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Restore overview layout', exact: true }).click();
  expect((await saved(page)).additionalProviderOrder).toEqual([]);
  await page.getByRole('button', { name: 'Undo overview layout reset', exact: true }).click();
  expect((await saved(page)).additionalProviderOrder).toEqual(preferences.additionalProviderOrder);
});

test('keyboard reordering retains focus, honors list edges, and reports failed saves without changing order', async ({ page }) => {
  await setup(page);
  const handle = page.getByRole('button', { name: 'Reorder Claude', exact: true });
  await handle.focus(); await page.keyboard.press('ArrowUp'); expect(await coreNames(page)).toEqual(['Claude', 'Codex', 'Cursor']);
  await page.keyboard.press('ArrowDown'); expect(await coreNames(page)).toEqual(['Codex', 'Claude', 'Cursor']); await expect(handle).toBeFocused();
  await page.keyboard.press('ArrowUp'); expect(await coreNames(page)).toEqual(['Claude', 'Codex', 'Cursor']);
  const before = await saved(page);
  await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (name, value) { if (name === key) throw new Error('Synthetic storage failure'); return original.call(this, name, value); }; }, SETTINGS_KEY);
  await handle.focus(); await page.keyboard.press('ArrowDown');
  expect(await coreNames(page)).toEqual(['Claude', 'Codex', 'Cursor']); expect(await saved(page)).toEqual(before);
  await expect(page.getByText('The provider order could not be saved.', { exact: true })).toBeVisible();
});

test('escape and drops outside the list cancel dragging; long lists scroll while dragging', async ({ page }) => {
  await setup(page);
  const before = await saved(page); const handle = page.getByRole('button', { name: 'Reorder Cursor', exact: true });
  const start = await handle.boundingBox(); const end = await page.locator('[data-reorder-id="claude"]').boundingBox();
  await page.mouse.move(start!.x + 8, start!.y + 8); await page.mouse.down(); await page.mouse.move(end!.x + 100, end!.y + 10, { steps: 5 }); await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await saved(page)).toEqual(before);
  await page.mouse.move(start!.x + 8, start!.y + 8); await page.mouse.down(); await page.mouse.move(5, 5, { steps: 5 }); await page.mouse.up();
  expect(await saved(page)).toEqual(before);
  await page.getByText('More providers', { exact: true }).click();
  const list = page.getByRole('list', { name: 'Additional providers', exact: true }); await list.locator('li').first().scrollIntoViewIfNeeded();
  const grip = list.getByRole('button', { name: 'Reorder Amp', exact: true }); const box = await grip.boundingBox();
  const scroll = page.locator('.quick-scroll'); const oldScroll = await scroll.evaluate(element => element.scrollTop); const area = await scroll.boundingBox();
  await page.mouse.move(box!.x + 8, box!.y + 8); await page.mouse.down(); await page.mouse.move(area!.x + area!.width / 2, area!.y + area!.height - 8, { steps: 8 });
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(oldScroll + 30);
  await page.keyboard.press('Escape'); await page.mouse.up(); expect(await saved(page)).toEqual(before);
});

test('saved additional order discards invalid IDs and deduplicates catalog entries', async ({ page }) => {
  await setup(page, { additionalProviderOrder: ['deepseek', '/private/path', 'unknown', 'amp', 'deepseek', 'amp\n', { label: 'PRIVATE_LABEL' }] });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // An appearance save persists normalized layout metadata without transferring account labels or paths.
  await page.getByRole('button', { name: 'light theme', exact: true }).click();
  expect((await saved(page)).additionalProviderOrder).toEqual(['deepseek', 'amp']);
  expect((await saved(page)).additionalProviderOrder.length).toBeLessThanOrEqual(catalog.length);
});

test('many selected providers keep Settings reachable and let other pages shrink again', async ({ page }) => {
  await page.exposeFunction('resizeNativePanel', async (height: number) => page.setViewportSize({ width: 360, height: Math.min(850, height) }));
  const providers = catalog.filter(provider => provider.state === 'ready');
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [], additionalConnections: providers.map(provider => ({ id: provider.id, label: provider.name, enabled: true, consentVersion: 1 })) }, additional: Object.fromEntries(providers.map(provider => [provider.id, { amounts: [{ label: 'Balance', value: 1, currency: 'USD', unit: '' }] }])) });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBe(850);
  await page.getByRole('button', { name: 'Xal details', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBeLessThan(500);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeInViewport({ ratio: 1 });
});
