import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['dark', 'light'] as const) {
  test(`${theme} dashboard has no serious accessibility violations`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: `${theme} theme`, exact: true }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('compact tray panel and Options have no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.goto('/?view=quick');
  for (const open of [false, true]) {
    if (open) await page.getByRole('button', { name: 'Options', exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  }
});
