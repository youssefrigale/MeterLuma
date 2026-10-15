import type { Page } from '@playwright/test';

// Synthetic data only. Nothing here reads real provider credentials or logs.
export const LEGAL = '1.1-providers-4';
export const SETTINGS_KEY = 'meterluma.settings.v2';

const iso = (date: Date) => date.toISOString().slice(0, 10);
export interface HistoryOptions { days?: number; today?: string; recordedDays?: number; tokens?: number; cost?: number | null; unpriced?: number; models?: { name: string; share: number }[] }
export function history({ days = 30, today = '2026-10-15', recordedDays, tokens = 100, cost = null, unpriced = 0, models = [{ name: 'recorded-model', share: 1 }] }: HistoryOptions = {}) {
  recordedDays ??= days;
  const end = new Date(`${today}T00:00:00Z`);
  const list = Array.from({ length: days }, (_, index) => {
    const date = new Date(end); date.setUTCDate(end.getUTCDate() - days + 1 + index);
    const recorded = index >= days - recordedDays;
    const total = recorded ? tokens : 0;
    return { date: iso(date), inputTokens: Math.round(total * .8), cachedInputTokens: Math.round(total * .2), cacheWriteTokens: 0, outputTokens: total - Math.round(total * .8), totalTokens: total, estimatedCostUsd: recorded ? cost : null, unpricedTokens: recorded ? unpriced : 0 };
  });
  const total = tokens * recordedDays;
  return { available: true, partial: false, periodDays: days, recordCount: recordedDays, scannedAt: 0, today, coverageStart: recordedDays ? list[days - recordedDays].date : null, days: list, models: models.map(model => ({ name: model.name, totalTokens: Math.round(total * model.share) })) };
}

export interface QuotaMock { plan?: string; metrics?: { label: string; usedPercent: number; resetIn: number | null }[]; ageMs?: number; error?: unknown; retryIn?: number; snapshot?: QuotaMock }
export interface BridgeOptions {
  settings: Record<string, unknown>;
  quotas?: Partial<Record<'codex' | 'cursor', QuotaMock>>;
  histories?: Partial<Record<'claude' | 'codex', ReturnType<typeof history>>>;
  failResizeOnce?: boolean;
  malformedQuota?: boolean;
  // Each quota response reports 5 points more usage than the previous one, so responses are distinguishable.
  rising?: boolean;
}
export type NativeCall = { command: string; args: Record<string, unknown> };

export async function nativeBridge(page: Page, options: BridgeOptions) {
  await page.addInitScript(options => {
    if (!localStorage.getItem('meterluma.settings.v2')) localStorage.setItem('meterluma.settings.v2', JSON.stringify(options.settings));
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    const waiting: (() => void)[] = [];
    const snapshot = (id: string, quota: QuotaMock, step = 0) => ({ id, name: id === 'codex' ? 'Codex' : 'Cursor', plan: quota.plan ?? 'Subscription', color: '#d97757', initials: '', spendToday: null, fetchedAt: Date.now() - (quota.ageMs ?? 0), metrics: options.malformedQuota ? null : (quota.metrics ?? []).map(metric => ({ label: metric.label, usedPercent: metric.usedPercent + step * 5, resetAt: metric.resetIn === null ? null : Date.now() + metric.resetIn })) });
    const state = window as unknown as { holdNative?: boolean };
    // Tests call holdNative() to keep later data requests pending until releaseNative().
    Object.assign(window, { isTauri: true, nativeCalls: calls, holdNative: false, releaseNative: (newestFirst = false) => { state.holdNative = false; const pending = waiting.splice(0); (newestFirst ? pending.reverse() : pending).forEach(resolve => resolve()); }, __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      const id = String(args.providerId ?? '');
      const step = options.rising ? calls.filter(call => call.command === 'refresh_provider' && call.args.providerId === id).length - 1 : 0;
      if (state.holdNative && (command === 'refresh_provider' || command === 'read_usage_history')) await new Promise<void>(resolve => waiting.push(resolve));
      if (command === 'refresh_provider') {
        const quota = (options.quotas as Record<string, QuotaMock | undefined> | undefined)?.[id];
        if (!quota) throw 'Unexpected quota request';
        if (quota.error !== undefined) throw typeof quota.error === 'object' ? { ...quota.error as object, ...(quota.retryIn ? { retryAt: Date.now() + quota.retryIn } : {}), ...(quota.snapshot ? { lastSnapshot: snapshot(id, quota.snapshot) } : {}) } : quota.error;
        return snapshot(id, quota, step);
      }
      if (command === 'read_usage_history') {
        const recorded = (options.histories as Record<string, ReturnType<typeof history> | undefined> | undefined)?.[id];
        if (!recorded) throw 'No recorded history';
        return { ...recorded, scannedAt: Date.now() };
      }
      if (command === 'resize_quick' && options.failResizeOnce && calls.filter(call => call.command === 'resize_quick').length === 1) throw 'The panel could not be positioned.';
      if (command === 'validate_profile') return args.directory;
      if (command === 'save_usage_export') return true;
    } } });
  }, options);
}

export const holdNative = (page: Page) => page.evaluate(() => { (window as unknown as { holdNative: boolean }).holdNative = true; });
export const releaseNative = (page: Page, newestFirst = false) => page.evaluate(newestFirst => (window as unknown as { releaseNative: (newestFirst: boolean) => void }).releaseNative(newestFirst), newestFirst);
export const countCalls = async (page: Page, command: string) => (await nativeCalls(page)).filter(call => call.command === command).length;
export const nativeCalls = (page: Page) => page.evaluate(() => (window as unknown as { nativeCalls: NativeCall[] }).nativeCalls);
export const lastExport = (page: Page, format: 'csv' | 'json') => page.evaluate(format => (window as unknown as { nativeCalls: NativeCall[] }).nativeCalls.filter(call => call.command === 'save_usage_export' && call.args.format === format).at(-1)?.args.content as string ?? '', format);
