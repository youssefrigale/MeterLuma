import { test, expect } from '@playwright/test';
import { LEGAL, history, nativeBridge, nativeCalls } from './fixtures';

test.use({ viewport: { width: 360, height: 440 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });

for (const availableHeight of [600, 1200]) test(`Mac content fits automatically within a ${availableHeight}-point screen`, async ({ page }, testInfo) => {
  // Native window resizing is the system boundary; apply its result to the browser viewport.
  await page.exposeFunction('resizeNativePanel', async (height: number) => page.setViewportSize({ width: 360, height: Math.min(availableHeight, height) }));
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, theme: 'dark', liveProviders: ['claude', 'codex'] },
    quotas: {
      claude: { plan: 'Team', metrics: [{ label: 'Session', usedPercent: 24, resetIn: 3_600_000 }, { label: 'Weekly', usedPercent: 12, resetIn: 4 * 86_400_000 }] },
      codex: { metrics: [{ label: 'Weekly', usedPercent: 31, resetIn: 86_400_000 }] },
    },
    histories: { claude: history({ cost: .1, models: Array.from({ length: 8 }, (_, index) => ({ name: `model-${index + 1}`, share: 1 / 8 })) }) },
  });
  const overflow = () => page.locator('.quick-scroll').evaluate(element => element.scrollHeight - element.clientHeight);
  await page.goto('/');
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Claude Weekly remaining', exact: true })).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.quick-data-note summary')).toBeInViewport({ ratio: 1 });
  const collapsed = page.viewportSize()!.height;
  await page.locator('.quick-more-models summary').click();
  await expect(page.getByText('model-8', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect.poll(() => page.viewportSize()!.height).toBeGreaterThan(collapsed);
  await page.locator('.quick-data-note summary').click();
  if (availableHeight === 600) {
    await expect.poll(() => page.viewportSize()!.height).toBe(availableHeight);
    await expect.poll(overflow).toBeGreaterThan(1);
  } else {
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.quick-data-note p')).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole('button', { name: /^MeterLuma .+ options$/ })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath(`claude-auto-height-${availableHeight}.png`) });
  const expanded = page.viewportSize()!.height;
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBeLessThan(expanded);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  expect((await nativeCalls(page)).filter(call => call.command === 'resize_quick').length).toBeLessThan(30);
});

// Settings once had a fixed 850-point height. It now follows the same measured path as every other page:
// its natural height when the screen fits it, the display work area with internal scrolling when it does not.
for (const availableHeight of [600, 4096]) test(`Mac Settings fits its content like other pages on a ${availableHeight}-point screen`, async ({ page }, testInfo) => {
  await page.exposeFunction('resizeNativePanel', async (height: number) => page.setViewportSize({ width: 360, height: Math.min(availableHeight, height) }));
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 30, resetIn: 86_400_000 }] } } });
  const tall = availableHeight > 600;
  const content = page.locator('.quick-scroll');
  const overflow = () => content.evaluate(element => element.scrollHeight - element.clientHeight);
  const height = () => page.viewportSize()!.height;
  const resizes = async () => (await nativeCalls(page)).filter(call => call.command === 'resize_quick').length;
  const options = page.getByRole('button', { name: /^MeterLuma .+ options$/ });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  if (tall) {
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    expect(height()).toBeGreaterThan(850);
    await expect(page.locator('.quick-settings > section').last()).toBeInViewport({ ratio: 1 });
  } else {
    await expect.poll(height).toBe(availableHeight);
    await expect.poll(overflow).toBeGreaterThan(1);
  }
  await expect(options).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath(`settings-auto-height-${availableHeight}.png`) });
  const settingsHeight = height();

  // A settled page sends no further resize requests: the measured height cannot feed back into itself.
  const settled = await resizes();
  await page.waitForTimeout(300);
  expect(await resizes()).toBe(settled);
  expect(settled).toBeLessThan(30);

  if (!tall) {
    await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('.quick-settings > section').last()).toBeInViewport({ ratio: 1 });
    expect(height()).toBe(settingsHeight);
    await expect(options).toBeInViewport({ ratio: 1 });
  }

  // Disclosure toggles and data changes grow and shrink the popup, within the screen.
  const disclosure = page.getByText('Notification history', { exact: true });
  const closedOverflow = await overflow();
  await disclosure.click();
  await page.getByRole('button', { name: 'Clear notification history', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Clear notification history', exact: true })).toBeInViewport({ ratio: 1 });
  if (tall) await expect.poll(height).toBeGreaterThan(settingsHeight);
  else { await expect.poll(overflow).toBeGreaterThan(closedOverflow); expect(height()).toBe(availableHeight); }
  await disclosure.click();
  await expect.poll(height).toBe(settingsHeight);
  await page.getByRole('button', { name: 'Add alert', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Remove Codex 80% alert', exact: true });
  await expect(remove).toBeVisible();
  if (tall) await expect.poll(height).toBeGreaterThan(settingsHeight);
  else expect(height()).toBe(availableHeight);
  await remove.click();
  await expect.poll(height).toBe(settingsHeight);
  await expect.poll(overflow).toBe(tall ? 0 : closedOverflow);
  await expect(options).toBeInViewport({ ratio: 1 });

  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect.poll(height).toBeLessThan(settingsHeight);
  const compactConnectionsHeight = height();
  await page.locator('.profile-accounts summary').click();
  await expect.poll(height).toBeGreaterThan(compactConnectionsHeight);
  await page.locator('.profile-accounts summary').click();
  await expect.poll(height).toBe(compactConnectionsHeight);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(height).toBe(settingsHeight);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await content.evaluate(element => element.scrollTop)).toBe(0);
});
