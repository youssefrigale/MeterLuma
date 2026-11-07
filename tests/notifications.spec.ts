import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL, nativeBridge, nativeCalls, countCalls, SETTINGS_KEY } from './fixtures';

const HISTORY = 'meterluma.notification-history.v1';
const now = new Date('2026-10-27T10:00:00Z');
const preferences: import('../src/notificationPreferences').NotificationPreferences = { enabled: true, low: true, thresholds: true, pace: false, resetMinutes: 0 };
const settings = { legalVersion: LEGAL, enabled: ['codex'], liveProviders: ['codex'] };

test('notifications require a separate opt-in, exclude account labels, group thresholds and survive reload without replay', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 660 });
  await page.clock.setFixedTime(now);
  await nativeBridge(page, { settings: { ...settings, profiles: [{ key: 'PRIVATE_PROFILE', providerId: 'codex', label: 'PRIVATE_ACCOUNT', directory: '/PRIVATE_PATH' }], alerts: [{ key: 'private_rule', providerId: 'codex', threshold: 80, enabled: true }] }, notificationPermission: 'authorized', quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 95, resetIn: 3_600_000 }] } } });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.getByRole('region', { name: 'Desktop notifications' });
  const enabled = section.getByRole('checkbox', { name: 'Send usage notifications', exact: true });
  await expect(enabled).toBeEnabled(); await expect(enabled).not.toBeChecked();
  expect(await countCalls(page, 'request_notification_permission')).toBe(0); expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
  await enabled.check();
  await expect.poll(() => countCalls(page, 'queue_usage_notification')).toBe(1);
  const queued = (await nativeCalls(page)).find(call => call.command === 'queue_usage_notification')!.args;
  expect(JSON.stringify(queued)).not.toMatch(/PRIVATE_|private_rule/);
  expect(queued.notices).toEqual([expect.objectContaining({ providerId: 'codex', metricLabel: 'Weekly', kind: 'low' }), expect.objectContaining({ providerId: 'codex', metricLabel: 'Weekly', kind: 'low' })]);
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: `${theme} theme`, exact: true }).click();
    await section.scrollIntoViewIfNeeded(); await section.screenshot({ path: testInfo.outputPath(`notification-settings-${theme}.png`) });
    expect((await new AxeBuilder({ page }).include('section[aria-label="Desktop notifications"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  const stored = await page.evaluate(key => localStorage.getItem(key), HISTORY);
  expect(stored).not.toMatch(/PRIVATE_|private_rule|Weekly|codex/);
  await page.getByRole('button', { name: /^Next update in \d+m, refresh now$/ }).click();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(1);
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(enabled).toBeChecked(); await expect(page.getByRole('button', { name: 'Refresh usage', exact: true })).toBeEnabled();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
  await enabled.uncheck();
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY)).notifications.enabled).toBe(false);
});

for (const permission of ['denied', 'unsupported', 'unavailable'] as const) test(`${permission} notification permission never enables the notification preference`, async ({ page }) => {
  await nativeBridge(page, { settings, notificationPermission: permission, requestedNotificationPermission: permission });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const enabled = page.getByRole('checkbox', { name: 'Send usage notifications', exact: true });
  if (permission === 'denied') {
    await expect(enabled).toBeEnabled(); await enabled.click();
    await expect(page.getByText('Notifications are not allowed. Enable MeterLuma in macOS notification settings, then check again.')).toBeVisible();
    await page.getByRole('button', { name: 'Open System Settings', exact: true }).click();
    expect(await countCalls(page, 'open_notification_settings')).toBe(1);
  } else await expect(enabled).toBeDisabled();
  await expect(enabled).not.toBeChecked(); expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
});

test('a permission prompt is requested only after the enable action, and a refusal keeps notifications off', async ({ page }) => {
  await nativeBridge(page, { settings, notificationPermission: 'not_determined', requestedNotificationPermission: 'denied' });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await countCalls(page, 'request_notification_permission')).toBe(0);
  const enabled = page.getByRole('checkbox', { name: 'Send usage notifications', exact: true });
  await expect(enabled).toBeEnabled(); await enabled.click();
  await expect.poll(() => countCalls(page, 'request_notification_permission')).toBe(1);
  await expect(enabled).not.toBeChecked(); expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
});

test('invalid local history pauses notifications; clearing it explicitly allows another attempt', async ({ page }) => {
  await nativeBridge(page, { settings: { ...settings, notifications: preferences }, notificationPermission: 'authorized', quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 95, resetIn: 3_600_000 }] } } });
  await page.addInitScript(key => localStorage.setItem(key, '{"corrupt":true}'), HISTORY);
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Notification history could not be read or saved/)).toBeVisible();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
  await page.getByText('Notification history', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear notification history', exact: true }).click();
  await expect.poll(() => countCalls(page, 'queue_usage_notification')).toBe(1);
});

test('a rejected OS request pauses delivery and its reserved attempt is not replayed after restart', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await nativeBridge(page, { settings: { ...settings, notifications: preferences }, notificationPermission: 'authorized', notificationError: true, quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 95, resetIn: 3_600_000 }] } } });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/macOS did not accept the usage notification/)).toBeVisible();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(1);
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Send usage notifications', exact: true })).toBeChecked();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
});

test('notification readings reject cached, stale, expired, future and history-only data, including additional warnings', async ({ page }) => {
  await page.goto('/');
  const readings = await page.evaluate(async () => {
    const path = '/src/notificationPolicy.ts'; const { notificationReadings } = await import(path) as typeof import('../src/notificationPolicy');
    const modelPath = '/src/model.ts'; const { defaults } = await import(modelPath) as typeof import('../src/model');
    const now = Date.now();
    const base: import('../src/model').Provider = { id: 'codex', name: 'Codex', plan: '', color: '', initials: '', spendToday: null, fetchedAt: now, metrics: [{ label: 'Weekly', usedPercent: 95, resetAt: now + 60_000 }] };
    const core = [base, { ...base, cached: true }, { ...base, historyOnly: true }, { ...base, quotaState: 'rate_limited' as const }, { ...base, fetchedAt: now + 1 }, { ...base, fetchedAt: now - 660_000 }, { ...base, metrics: [{ ...base.metrics[0], resetAt: now }] }, { ...base, metrics: [{ ...base.metrics[0], usedPercent: NaN }] }];
    const additional = [{ id: 'zed', label: 'PRIVATE_LABEL', loading: false, snapshot: { id: 'zed', name: 'Zed', plan: null, amounts: [], metrics: base.metrics, fetchedAt: now, cached: false, notice: null, warning: true } }];
    return notificationReadings({ ...defaults, enabled: ['codex'], liveProviders: ['codex'], additionalConnections: [{ id: 'zed', label: 'Zed', consentVersion: 1 }] }, core, additional, now);
  });
  expect(readings).toHaveLength(1); expect(readings[0]).toMatchObject({ providerId: 'codex', label: 'Weekly', usedPercent: 95 });
});

test('pace uses a quiet initial baseline, deduplicates worsening episodes, and allows a later recovery episode', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] } });
  await page.goto('/');
  const outcomes = await page.evaluate(async () => {
    const modelPath = '/src/model.ts'; const { defaults } = await import(modelPath) as typeof import('../src/model');
    const policyPath = '/src/notificationPolicy.ts'; const policy = await import(policyPath) as typeof import('../src/notificationPolicy');
    const deliveryPath = '/src/notificationDelivery.ts'; const { deliverUsageNotices } = await import(deliveryPath) as typeof import('../src/notificationDelivery');
    const start = Date.now(); const originalNow = Date.now; const episodes = new Map<string, import('../src/notificationPolicy').PaceEpisode>();
    const settings = { ...defaults, notifications: { enabled: true, low: false, thresholds: false, pace: true, resetMinutes: 0 as const } };
    const outcomes: boolean[] = [];
    try {
      for (const [index, usedPercent] of [40, 46, 55, 55, 40, 60].entries()) {
        const now = start + index * 61_000; Date.now = () => now;
        const reading = { providerId: 'codex', connection: 'PRIVATE_PROFILE', label: 'Session', usedPercent, resetAt: start + 50 * 60_000, periodMinutes: 100, fetchedAt: now };
        outcomes.push(await deliverUsageNotices(policy.notificationCandidates(settings, [reading], now, episodes), () => true));
      }
    } finally { Date.now = originalNow; }
    return outcomes;
  });
  expect(outcomes).toEqual([false, true, true, false, false, true]);
  const notices = (await nativeCalls(page)).filter(call => call.command === 'queue_usage_notification').flatMap(call => call.args.notices as { kind: string }[]);
  expect(notices.map(notice => notice.kind)).toEqual(['pace_close', 'pace_risk', 'pace_risk']);
});

test('reset reminders preserve actual zero allowance usage and never fabricate a reset or send exhausted windows', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] } }); await page.goto('/');
  const kinds = await page.evaluate(async () => {
    const modelPath = '/src/model.ts'; const { defaults } = await import(modelPath) as typeof import('../src/model');
    const path = '/src/notificationPolicy.ts'; const { notificationCandidates } = await import(path) as typeof import('../src/notificationPolicy');
    const now = Date.now(); const settings = { ...defaults, notifications: { enabled: true, low: false, thresholds: false, pace: false, resetMinutes: 60 as const } };
    const base = { providerId: 'zed', connection: 'zed', label: 'Predictions', usedPercent: 0, resetAt: now + 60 * 60_000, fetchedAt: now };
    return [base, { ...base, resetAt: null }, { ...base, resetAt: now + 60 * 60_000 + 1 }, { ...base, usedPercent: 100 }].map(reading => notificationCandidates(settings, [reading], now, new Map()).map(notice => notice.kind));
  });
  expect(kinds).toEqual([['reset'], [], [], []]);
});

test('missing provider consent blocks notifications even if a saved preference says enabled', async ({ page }) => {
  await nativeBridge(page, { settings: { ...settings, legalVersion: '', notifications: preferences }, notificationPermission: 'authorized', quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 95, resetIn: 3_600_000 }] } } });
  await page.goto('/'); await expect(page.getByRole('dialog', { name: 'Before you connect' })).toBeVisible();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(0); expect(await countCalls(page, 'request_notification_permission')).toBe(0);
});

test('saved coarse pace state detects worsening after restart and never stores raw profile or quota labels', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] } }); await page.goto('/');
  const outcomes = await page.evaluate(async () => {
    const modelPath = '/src/model.ts'; const { defaults } = await import(modelPath) as typeof import('../src/model');
    const policyPath = '/src/notificationPolicy.ts'; const policy = await import(policyPath) as typeof import('../src/notificationPolicy');
    const deliveryPath = '/src/notificationDelivery.ts'; const { deliverUsageNotices } = await import(deliveryPath) as typeof import('../src/notificationDelivery');
    const pacePath = '/src/notificationPace.ts'; const pace = await import(pacePath) as typeof import('../src/notificationPace');
    const settings = { ...defaults, notifications: { enabled: true, low: false, thresholds: false, pace: true, resetMinutes: 0 as const } };
    const start = Date.now(); const originalNow = Date.now; const outcomes: boolean[] = [];
    try {
      for (const [index, usedPercent] of [40, 46, 46, 60].entries()) {
        const now = start + index * 61_000; Date.now = () => now;
        const reading = { providerId: 'codex', connection: 'PRIVATE_PROFILE', label: 'PRIVATE_QUOTA', usedPercent, resetAt: start + 50 * 60_000, periodMinutes: 100, fetchedAt: now };
        const episodes = new Map<string, import('../src/notificationPolicy').PaceEpisode>();
        await pace.restoreNotificationPace([reading], episodes);
        const candidates = policy.notificationCandidates(settings, [reading], now, episodes);
        await pace.saveNotificationPace([reading], episodes);
        outcomes.push(await deliverUsageNotices(candidates, () => true));
      }
    } finally { Date.now = originalNow; }
    const saved = localStorage.getItem(pace.NOTIFICATION_PACE)!;
    return { outcomes, saved, count: JSON.parse(saved).length };
  });
  expect(outcomes.outcomes).toEqual([false, true, false, true]);
  expect(outcomes.saved).not.toMatch(/PRIVATE_|codex/); expect(outcomes.count).toBe(1);
});

test('delivery groups at most three quotas per minute and checks cancellation before reserving another request', async ({ page }) => {
  await nativeBridge(page, { settings: { legalVersion: LEGAL, enabled: [], liveProviders: [] } }); await page.goto('/');
  const outcomes = await page.evaluate(async preferences => {
    const modelPath = '/src/model.ts'; const { defaults } = await import(modelPath) as typeof import('../src/model');
    const policyPath = '/src/notificationPolicy.ts'; const policy = await import(policyPath) as typeof import('../src/notificationPolicy');
    const deliveryPath = '/src/notificationDelivery.ts'; const { deliverUsageNotices } = await import(deliveryPath) as typeof import('../src/notificationDelivery');
    const start = Date.now(); const originalNow = Date.now;
    const settings = { ...defaults, notifications: preferences };
    const readings = Array.from({ length: 4 }, (_, index) => ({ providerId: 'codex', connection: `profile_${index}`, label: 'Weekly', usedPercent: 95, resetAt: start + 3_600_000, fetchedAt: start }));
    const candidates = policy.notificationCandidates(settings, readings, start, new Map());
    try {
      const first = await deliverUsageNotices(candidates, () => true);
      const throttled = await deliverUsageNotices(candidates, () => true);
      Date.now = () => start + 61_000;
      const cancelled = await deliverUsageNotices(candidates, () => false);
      const resumed = await deliverUsageNotices(candidates, () => true);
      return [first, throttled, cancelled, resumed];
    } finally { Date.now = originalNow; }
  }, preferences);
  expect(outcomes).toEqual([true, false, false, true]);
  expect((await nativeCalls(page)).filter(call => call.command === 'queue_usage_notification').map(call => (call.args.notices as unknown[]).length)).toEqual([3, 1]);
});

test('a storage failure stops notification dispatch before an unrecorded attempt can reach macOS', async ({ page }) => {
  await nativeBridge(page, { settings: { ...settings, notifications: preferences }, notificationPermission: 'authorized', quotas: { codex: { metrics: [{ label: 'Weekly', usedPercent: 95, resetIn: 3_600_000 }] } } });
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, contents) { if (name === key) throw new DOMException('Synthetic storage full', 'QuotaExceededError'); original.call(this, name, contents); };
  }, HISTORY);
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Notification history could not be read or saved/)).toBeVisible();
  expect(await countCalls(page, 'queue_usage_notification')).toBe(0);
});

test('a paused, disconnected or token-suppressed connection cannot notify from its previous visible snapshot', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const modelPath = '/src/model.ts'; const { defaults } = await import(modelPath) as typeof import('../src/model');
    const path = '/src/notificationPolicy.ts'; const { notificationReadings } = await import(path) as typeof import('../src/notificationPolicy');
    const now = Date.now(); const metrics = [{ label: 'Weekly', usedPercent: 95, resetAt: now + 60_000 }];
    const provider: import('../src/model').Provider = { id: 'codex', name: 'Codex', plan: '', color: '', initials: '', spendToday: null, fetchedAt: now, connectionKey: 'profile', metrics };
    const profile = { key: 'profile', providerId: 'codex' as const, label: 'Private label', directory: '/private/path' };
    const snapshot = { id: 'zed', name: 'Zed', plan: null, amounts: [], metrics, fetchedAt: now, cached: false, notice: null };
    return [
      notificationReadings({ ...defaults, profiles: [profile] }, [provider], [], now).length,
      notificationReadings({ ...defaults, profiles: [{ ...profile, paused: true }] }, [provider], [], now).length,
      notificationReadings({ ...defaults, profiles: [profile], tokenProviders: ['codex'], liveProviders: ['codex'] }, [provider], [], now).length,
      notificationReadings({ ...defaults, liveProviders: [] }, [{ ...provider, connectionKey: 'codex' }], [], now).length,
      notificationReadings({ ...defaults, additionalConnections: [{ id: 'zed', label: 'Zed', consentVersion: 1, enabled: false }] }, [], [{ id: 'zed', label: 'Zed', snapshot }], now).length,
      notificationReadings({ ...defaults, additionalConnections: [{ id: 'zed', label: 'Zed', consentVersion: 1, enabled: true }] }, [], [{ id: 'zed', label: 'Zed', snapshot }], now).length,
    ];
  });
  expect(results).toEqual([1, 0, 0, 0, 0, 1]);
});
