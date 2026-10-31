import { test, expect } from '@playwright/test';
import { LEGAL, nativeBridge, history } from './fixtures';

const settings = { legalVersion: LEGAL, claudeLive: true, enabled: ['claude'], liveProviders: ['claude'] };
const metrics = [{ label: 'Session', usedPercent: 25, resetIn: 3_600_000 }];

test('Claude extra usage distinguishes account spending and its currency from local API-value Costs', async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: { metrics, claudeExtraUsage: { spent: 2.5, monthlyLimit: 10, currency: 'EUR', decimalPlaces: 2 } } }, histories: { claude: history({ cost: 4 }) } });
  await page.goto('/');
  const extra = page.getByRole('region', { name: 'Claude extra usage' });
  await expect(extra).toContainText('€2.50'); await expect(extra).toContainText('€10.00');
  await expect(extra).toContainText('Spent'); await expect(extra).toContainText('Monthly limit');
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect(extra).toContainText('Separate from token-value Costs.');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Today estimated API value: $4.00', exact: true })).toBeVisible();
  await expect(page.locator('.quick-cost')).not.toContainText('€');
});

for (const [name, quota] of [
  ['unknown units', { metrics, claudeExtraUsage: { spent: null, monthlyLimit: null, currency: null, decimalPlaces: null } }],
  ['zero amount', { metrics, claudeExtraUsage: { spent: 0, monthlyLimit: null, currency: 'JPY', decimalPlaces: 0 } }],
  ['stale', { metrics, ageMs: 301_000, claudeExtraUsage: { spent: 2.5, monthlyLimit: 10, currency: 'EUR', decimalPlaces: 2 } }],
  ['cached', { error: { code: 'unavailable', message: 'Offline' }, snapshot: { metrics, claudeExtraUsage: { spent: 2.5, monthlyLimit: 10, currency: 'EUR', decimalPlaces: 2 } } }],
] as const) test(`Claude extra usage preserves ${name} semantics`, async ({ page }) => {
  await nativeBridge(page, { settings, quotas: { claude: quota }, histories: { claude: history() } });
  await page.goto('/');
  const extra = page.getByRole('region', { name: 'Claude extra usage' });
  if (name === 'stale' || name === 'cached') await expect(extra).toHaveCount(0);
  else if (name === 'unknown units') { await expect(extra).toContainText('Unavailable'); await expect(extra).not.toContainText('$0'); }
  else { await expect(extra).toContainText('¥0'); await expect(extra).toContainText('Not reported'); }
});
