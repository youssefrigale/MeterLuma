import { isTauri } from '@tauri-apps/api/core';
import type { Settings } from './model';
import type { LiveResult } from './useLiveProviders';
import { additionalProvider, type AdditionalResult } from './additional/model';
import { APP_VERSION } from './format';
import { recentLookupDiagnostics } from './lookupDiagnostics';

function age(timestamp: number | undefined, now: number) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  return timestamp > now ? 'future' : Math.floor((now - timestamp) / 1000);
}

function coreStatus(connection: LiveResult, now: number) {
  const provider = connection.provider;
  return {
    provider: connection.id, pending: connection.loading === true, historyPending: connection.historyLoading === true,
    quotaState: connection.quotaFailure?.code ?? provider?.quotaState ?? 'unavailable', cached: provider?.cached === true,
    ageSeconds: age(provider?.fetchedAt, now), quotaWindows: provider?.metrics.length ?? 0,
    expiredWindows: provider?.metrics.filter(metric => metric.resetAt !== null && metric.resetAt <= now).length ?? 0,
    history: provider?.history ? { available: provider.history.available, partial: provider.history.partial, days: provider.history.days.length } : null,
  };
}

function additionalStatus(connection: AdditionalResult, now: number) {
  const snapshot = connection.snapshot;
  return {
    provider: additionalProvider(connection.id)?.id ?? 'unknown', source: additionalProvider(connection.id)?.source ?? 'unknown',
    pending: connection.loading === true, failed: !!connection.error, cached: snapshot?.cached === true, warning: snapshot?.warning === true,
    ageSeconds: age(snapshot?.fetchedAt, now), quotaWindows: snapshot?.metrics.length ?? 0, reportedAmountFields: snapshot?.amounts.length ?? 0,
  };
}

export function diagnosticReport(settings: Settings, core: LiveResult[], additional: AdditionalResult[]) {
  const now = Date.now();
  return {
    kind: 'MeterLumaDiagnostics', formatVersion: 1, appVersion: APP_VERSION, generatedAt: new Date(now).toISOString(),
    runtime: isTauri() ? 'native' : 'web-preview', platform: /Mac/i.test(navigator.userAgent) ? 'macOS' : /Windows/i.test(navigator.userAgent) ? 'Windows' : 'other',
    scope: 'Local status and the last 20 frontend lookup attempts. No credentials, account labels, local paths, raw responses, quota values, token totals or balances.',
    timingScope: 'Elapsed frontend lookup time, including waiting. A native reader may continue after a frontend timeout. No native HTTP or process timing is inferred.',
    settings: { refreshMinutes: settings.refreshMinutes, historyDays: settings.historyDays, demo: settings.demo },
    core: core.map(connection => coreStatus(connection, now)), additional: additional.map(connection => additionalStatus(connection, now)),
    lookups: recentLookupDiagnostics(),
  };
}
