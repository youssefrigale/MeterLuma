import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider, UsageHistory } from './model';
import { APP_VERSION } from './format';
import { coverage } from './coverage';

export const CURSOR_HISTORY_NOTE = 'Cursor token history is not recorded locally. Only the monthly allowance is available.';

// Days before coverageStart have no local logs: they are exported as recorded=false with empty values, never as zero.
function exportHistory(history: UsageHistory) {
  const range = coverage(history);
  return { ...history, coverageStart: range.start, days: history.days.map(day => range.isRecorded(day.date)
    ? { ...day, recorded: true, estimatedCostUsd: day.estimatedCostUsd ?? null, unpricedTokens: day.unpricedTokens ?? 0 }
    : { date: day.date, recorded: false, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null, unpricedTokens: null }) };
}

export function exportData(providers: Provider[], demo: boolean) {
  return {
    formatVersion: 2,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    mode: demo ? 'demo' : 'live',
    scope: 'Recorded activity in selected local profiles on this device; not account-wide billing.',
    notes: 'Days with recorded=false have no local logs (for example, Claude Code deletes transcripts after 30 days by default); they are not zero-usage days. estimatedCostUsd is an API-value estimate for priced tokens only, not a bill; unpricedTokens are excluded from it.',
    providers: providers.map(provider => ({
      provider: provider.id, account: provider.accountLabel ?? 'Default local profile',
      quotas: provider.historyOnly ? 'none' : provider.id === 'cursor' ? 'unofficial' : 'official',
      fetchedAt: provider.fetchedAt ?? null, cached: provider.cached ?? false, quotaState: provider.quotaState ?? null, retryAt: provider.retryAt ?? null, metrics: provider.metrics,
      history: provider.history ? exportHistory(provider.history) : null,
      ...(provider.id === 'cursor' ? { historyNote: CURSOR_HISTORY_NOTE } : {}),
    })),
  };
}

// Quoting CSV alone does not prevent spreadsheet formula execution.
function cell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function usageCsv(providers: Provider[], demo: boolean) {
  const rows: unknown[][] = [['mode', 'provider', 'account', 'date', 'recorded', 'input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'total_tokens', 'unpriced_tokens', 'estimated_api_value_usd', 'partial', 'scope']];
  for (const provider of providers) {
    if (!provider.history?.available) continue;
    const range = coverage(provider.history);
    for (const day of provider.history.days) {
      const recorded = range.isRecorded(day.date);
      rows.push([
        demo ? 'demo' : 'live', provider.id, provider.accountLabel ?? 'Default local profile', day.date, recorded,
        ...(recorded ? [day.inputTokens, day.cachedInputTokens, day.cacheWriteTokens, day.outputTokens, day.totalTokens, day.unpricedTokens ?? 0, day.estimatedCostUsd ?? ''] : ['', '', '', '', '', '', '']),
        provider.history.partial, 'Selected local profile on this device; not account-wide billing',
      ]);
    }
  }
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function downloadUsage(providers: Provider[], demo: boolean, format: 'csv' | 'json') {
  const content = format === 'csv' ? usageCsv(providers, demo) : JSON.stringify(exportData(providers, demo), null, 2);
  if (isTauri()) return invoke<boolean>('save_usage_export', { format, content });
  const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `MeterLuma-${demo ? 'demo' : 'usage'}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
