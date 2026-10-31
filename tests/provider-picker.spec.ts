import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import catalog from '../src/additional/catalog.json' with { type: 'json' };
import { LEGAL, nativeBridge, countCalls } from './fixtures';

test.use({ viewport: { width: 360, height: 850 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });

for (const theme of ['dark', 'light']) test(`${theme} provider picker keeps logos and connection controls in compact rows`, async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('http') && !request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
  await nativeBridge(page, { settings: { legalVersion: LEGAL, theme, liveProviders: [], enabled: [], additionalConnections: [{ id: 'deepseek', label: 'DeepSeek', enabled: true, consentVersion: 1 }] }, additional: { deepseek: { amounts: [{ label: 'Balance', value: 1, currency: 'USD', unit: '' }] } } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('More providers', { exact: true }).click();
  const list = page.getByRole('list', { name: 'Additional providers', exact: true });
  const rows = list.locator(':scope > li');
  await expect(rows).toHaveCount(catalog.filter(provider => provider.state === 'ready').length);
  const names = await list.getByRole('heading').allTextContents();
  expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  const heights = await rows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThanOrEqual(60);
  await expect.poll(() => list.locator('img.additional-logo').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const maskUrls = await list.locator('.additional-logo-mask').evaluateAll(elements => elements.map(element => getComputedStyle(element).maskImage));
  expect(maskUrls.length).toBeGreaterThan(0);
  expect(maskUrls).not.toContain('none');
  const failedMasks = await page.evaluate(async urls => {
    const decoded = await Promise.all(urls.map(cssUrl => new Promise<string | null>(resolve => {
      const src = cssUrl.slice(4, -1).replace(/^"|"$/g, '');
      const image = new Image(); image.onload = () => resolve(null); image.onerror = () => resolve(src); image.src = src;
    })));
    return decoded.filter(src => src !== null);
  }, maskUrls);
  expect(failedMasks).toEqual([]);
  for (const provider of catalog.filter(provider => provider.state === 'ready')) await expect(list.getByRole('button', { name: `${provider.id === 'deepseek' ? 'Disconnect' : 'Connect'} ${provider.name}`, exact: true })).toHaveAttribute('aria-pressed', String(provider.id === 'deepseek'));
  await page.locator('.additional-connections').evaluate(element => element.scrollIntoView());
  await page.screenshot({ path: testInfo.outputPath(`provider-picker-${theme}.png`) });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await list.getByRole('button', { name: 'Connect Zed', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Zed', exact: true });
  await expect(dialog).toContainText(catalog.find(provider => provider.id === 'zed')!.description);
  await expect(dialog.getByRole('button', { name: 'Connect Zed', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(list.getByRole('button', { name: 'Connect Zed', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await countCalls(page, 'connect_additional_provider')).toBe(0);
  await list.getByRole('button', { name: 'Replace DeepSeek key', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect DeepSeek', exact: true }).getByLabel('API key', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await list.getByRole('button', { name: 'Disconnect DeepSeek', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Connect DeepSeek', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await countCalls(page, 'forget_additional_provider')).toBe(1);
  await page.getByText('Other requested providers', { exact: true }).click();
  const unavailable = page.getByRole('list', { name: 'Providers without usage tracking', exact: true });
  await expect(unavailable.getByRole('button', { name: 'Open Duck.ai dashboard', exact: true })).toBeVisible();
  await expect(unavailable.locator('[aria-pressed]')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});
