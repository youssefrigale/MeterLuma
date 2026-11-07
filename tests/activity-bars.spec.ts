import { test, expect } from '@playwright/test';
import { LEGAL, history, nativeBridge } from './fixtures';

// Ring A: activity bars use the brand yellow, with the darker readable gold on the light panel.
const brand = { dark: 'rgb(239, 216, 92)', light: 'rgb(120, 101, 0)' };
const platforms = {
  Mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  Windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36',
};

function luminance(color: string) {
  const [red, green, blue] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * red + .7152 * green + .0722 * blue;
}
const contrast = (first: string, second: string) => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
};

for (const [platform, userAgent] of Object.entries(platforms)) test.describe(`${platform} activity bars`, () => {
  test.use({ viewport: { width: 360, height: 660 }, userAgent });
  for (const theme of ['dark', 'light'] as const) test(`${theme} theme paints recorded activity in the brand colour`, async ({ page }) => {
    await nativeBridge(page, { settings: { legalVersion: LEGAL, theme, liveProviders: ['claude'], enabled: ['claude'] }, histories: { claude: history({ recordedDays: 10, tokens: 1000 }) } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Claude details', exact: true }).click();
    const recorded = page.locator('.quick-sparkbars i:not(.unrecorded)');
    await expect(recorded).toHaveCount(10);
    const painted = await recorded.evaluateAll(bars => bars.map(bar => ({ color: getComputedStyle(bar).backgroundColor, opacity: getComputedStyle(bar).opacity })));
    expect(painted).toEqual(Array(10).fill({ color: brand[theme], opacity: '1' }));
    // WCAG 1.4.11: informative graphics need 3:1 against the panel behind them.
    const panel = await page.locator('.quick-view').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(contrast(brand[theme], panel)).toBeGreaterThanOrEqual(3);
    // Days without local logs stay hatched rather than filled.
    const unrecorded = await page.locator('.quick-sparkbars i.unrecorded').first().evaluate(element => getComputedStyle(element).backgroundImage);
    expect(unrecorded).toContain('repeating-linear-gradient');
  });
});
