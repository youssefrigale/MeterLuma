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
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath(`claude-auto-height-${availableHeight}.png`) });
  const expanded = page.viewportSize()!.height;
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBeLessThan(expanded);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  expect((await nativeCalls(page)).filter(call => call.command === 'resize_quick').length).toBeLessThan(30);
});

for (const availableHeight of [600, 1200]) test(`Mac Settings alone uses a fixed scrolling height on a ${availableHeight}-point screen`, async ({ page }, testInfo) => {
  await page.exposeFunction('resizeNativePanel', async (height: number) => page.setViewportSize({ width: 360, height: Math.min(availableHeight, height) }));
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'] }, quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 30, resetIn: 86_400_000 }] } } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settingsHeight = Math.min(availableHeight, 850);
  await expect.poll(() => page.viewportSize()!.height).toBe(settingsHeight);
  const content = page.locator('.quick-scroll');
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath(`settings-fixed-height-${availableHeight}.png`) });
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.quick-settings > section').last()).toBeInViewport({ ratio: 1 });
  expect(page.viewportSize()!.height).toBe(settingsHeight);
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBeLessThan(settingsHeight);
  const compactConnectionsHeight = page.viewportSize()!.height;
  await page.locator('.profile-accounts summary').click();
  await expect.poll(() => page.viewportSize()!.height).toBeGreaterThan(compactConnectionsHeight);
  await page.locator('.profile-accounts summary').click();
  await expect.poll(() => page.viewportSize()!.height).toBe(compactConnectionsHeight);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => page.viewportSize()!.height).toBe(settingsHeight);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await content.evaluate(element => element.scrollTop)).toBe(0);
});
