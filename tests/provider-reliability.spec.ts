import { test, expect } from '@playwright/test';
import { LEGAL, countCalls, history, nativeBridge, nativeCalls } from './fixtures';
import { usageProjection } from '../src/pacing';

test('pace is shown only for known live windows and menu selection persists independently of page', async ({ page }) => {
  await page.clock.install();
  await nativeBridge(page,{settings:{legalVersion:LEGAL,liveProviders:['codex'],enabled:['codex'],pacing:true,trayMetric:'weekly'},quotas:{codex:{metrics:[{label:'Session',usedPercent:25,periodMinutes:300,resetIn:150*60000},{label:'Weekly',usedPercent:80,periodMinutes:10080,resetIn:5040*60000}]}},histories:{codex:history()}});
  await page.goto('/');await expect(page.locator('.quick-pace')).toHaveText(['At current pace: 50% used by reset','At current pace: 160% used by reset']);
  await expect.poll(async()=>(await nativeCalls(page)).filter(call=>call.command==='set_tray_summary').at(-1)?.args.status).toMatchObject({provider:'codex',remaining:20});
  await page.reload();await expect(page.locator('.quick-pace')).toHaveCount(2);
  const now=Date.now();
  for (const metric of [{label:'Monthly',usedPercent:20,resetAt:now+3600000},{label:'Session',usedPercent:20,periodMinutes:300,resetAt:now-1},{label:'Session',usedPercent:20,periodMinutes:300,resetAt:now+300*60000}]) expect(usageProjection(metric,now)).toBeUndefined();
});

test('live Claude threshold alerts survive reload', async ({ page }) => {
  await nativeBridge(page,{settings:{legalVersion:LEGAL,claudeLive:true,liveProviders:['claude'],enabled:['claude'],alerts:[{key:'claude-warning',providerId:'claude',threshold:80,enabled:true}]},quotas:{claude:{metrics:[{label:'Session',usedPercent:85,resetIn:3600000}]}},histories:{claude:history()}});
  await page.goto('/');await expect(page.getByRole('region',{name:'Usage alerts'})).toContainText('Session is 85% used');
  await page.reload();await expect(page.getByRole('region',{name:'Usage alerts'})).toContainText('Session is 85% used');
});

test('a hung Codex quota request times out without hiding completed history or wedging refresh', async ({ page }) => {
  await page.clock.install();
  await nativeBridge(page, { settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'] }, histories: { codex: history({ cost: .31, tokens: 210000 }) } });
  await page.addInitScript(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = (command, args) => command === 'refresh_provider' ? new Promise(() => {}) : invoke(command, args);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Costs', exact: true }).click();
  await expect(page.locator('.quick-cost-amount')).toHaveText('$0.31');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
  await page.clock.runFor(75_001);
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await page.getByRole('button', { name: 'Codex details' }).click();
  await expect(page.getByText('The usage lookup took too long. Try refreshing again.')).toBeVisible();
  await expect(page.locator('.quick-usage-totals')).toContainText('$0.31');
});

test('the menu bar keeps a healthy selected provider clear when another provider fails', async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude', 'codex'] },
    quotas: { claude: { metrics: [{ label: 'Session', usedPercent: 25, resetIn: 3_600_000 }] }, codex: { error: 'Usage lookup failed.' } },
    histories: { claude: history(), codex: history() },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status).toMatchObject({ provider: 'claude', remaining: 75, warning: false });
  await expect.poll(async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.summary).toContain('Codex: usage lookup failed');
});

for (const exhausted of [false, true]) test(`81% left stays clear with ${exhausted ? 'an exhausted unselected weekly window' : 'healthy weekly usage'}`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'] },
    quotas: { codex: { metrics: [{ label: 'Session', usedPercent: 19, resetIn: 3_600_000 }, { label: 'Weekly', usedPercent: exhausted ? 100 : 30, resetIn: 86_400_000 }] } },
    histories: { codex: history() },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
  const menu = async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args;
  await expect.poll(async () => (await menu())?.status).toMatchObject({ provider: 'codex', remaining: 81, warning: false });
  await expect.poll(async () => (await menu())?.summary).toContain(exhausted ? 'Codex: Weekly exhausted' : 'Codex Session 81% left');
});

for (const future of [false, true]) test(`hidden background refresh ${future ? 'preserves future-timestamp diagnostics without a low-usage triangle' : 'does not falsely warn about fresh data before the panel opens'}`, async ({ page }) => {
  const start = new Date('2030-01-01T00:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, enabled: ['claude'], liveProviders: ['claude'], refreshMinutes: 5, additionalConnections: [{ id: 'opencode', label: 'OpenCode', consentVersion: 1 }] },
    quotas: { claude: { metrics: [{ label: 'Session', usedPercent: 18, resetIn: 3_600_000 }] } },
    histories: { claude: history() },
    additional: { opencode: { metrics: [{ label: 'Session', usedPercent: 10, resetAt: null }], ...(future ? { fetchedAt: start.getTime() + 3_600_000 } : {}) } },
  });
  await page.goto('/');
  const menuStatus = async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status;
  const menuSummary = async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.summary;
  await expect.poll(menuStatus).toMatchObject({ provider: 'claude', remaining: 82, warning: false });
  await expect.poll(menuSummary).toContain(future ? 'usage timestamp is in the future' : 'Claude Session 82% left');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(301_000);
  await expect.poll(() => countCalls(page, 'refresh_additional_provider')).toBeGreaterThanOrEqual(2);
  await expect.poll(menuStatus).toMatchObject({ provider: 'claude', remaining: 82, warning: false });
  await expect.poll(menuSummary).toContain(future ? 'usage timestamp is in the future' : 'Claude Session 82% left');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await expect.poll(menuStatus).toMatchObject({ provider: 'claude', remaining: 82, warning: false });
  await expect.poll(menuSummary).toContain(future ? 'usage timestamp is in the future' : 'Claude Session 82% left');
});

for (const usedPercent of [74.9, 75, 100]) test(`the selected Codex window at ${usedPercent}% used follows the low-allowance threshold`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude', 'codex'], enabled: ['claude', 'codex'], trayMetric: 'weekly' },
    quotas: { claude: { metrics: [{ label: 'Weekly', usedPercent: 10, resetIn: 86_400_000 }] }, codex: { metrics: [{ label: 'Session', usedPercent: 0, resetIn: 3_600_000 }, { label: 'Weekly', usedPercent, resetIn: 86_400_000 }] } },
    histories: { claude: history(), codex: history() },
  });
  await page.goto('/');
  const menuStatus = async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status;
  await expect.poll(menuStatus).toMatchObject({ provider: 'claude', remaining: 90, warning: false });
  await page.getByRole('button', { name: 'Codex details', exact: true }).click();
  await expect.poll(menuStatus).toMatchObject({ provider: 'codex', remaining: Math.round(100 - usedPercent), warning: usedPercent >= 75 });
  await page.getByRole('button', { name: 'Claude details', exact: true }).click();
  await expect.poll(menuStatus).toMatchObject({ provider: 'claude', remaining: 90, warning: false });
});

for (const usedPercent of [20, 75]) test(`selected OpenCode usage at ${usedPercent}% used has an independent low-allowance triangle`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, liveProviders: ['codex'], enabled: ['codex'], additionalConnections: [{ id: 'opencode', label: 'OpenCode', consentVersion: 1 }] },
    quotas: { codex: { metrics: [{ label: 'Session', usedPercent: 80, resetIn: 3_600_000 }] } },
    histories: { codex: history() },
    additional: { opencode: { metrics: [{ label: 'Session', usedPercent, resetAt: null }] } },
  });
  await page.goto('/');
  const menuStatus = async () => (await nativeCalls(page)).filter(call => call.command === 'set_tray_summary').at(-1)?.args.status;
  await expect.poll(menuStatus).toMatchObject({ provider: 'codex', remaining: 20, warning: true });
  await page.getByRole('button', { name: /^OpenCode.* details$/ }).click();
  await expect.poll(menuStatus).toMatchObject({ provider: 'opencode', remaining: 100 - usedPercent, warning: usedPercent >= 75 });
});

for (const remaining of [false, true]) test(`sub-one-percent usage is preserved in ${remaining ? 'remaining' : 'used'} captions`, async ({ page }) => {
  await nativeBridge(page, {
    settings: { legalVersion: LEGAL, claudeLive: true, liveProviders: ['claude'], enabled: ['claude'], remaining },
    quotas: { claude: { metrics: [{ label: 'Session', usedPercent: .04, resetIn: 3_600_000 }] } },
    histories: { claude: history() },
  });
  await page.goto('/');
  await expect(page.locator('.quick-metric-caption')).toContainText(remaining ? '>99.9% left' : '<0.1% used');
  await expect(page.locator('.quick-metric-caption span').last()).toHaveAttribute('title', /.+/);
});
