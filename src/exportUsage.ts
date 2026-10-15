import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider } from './model';

export function exportData(providers: Provider[], demo: boolean) {
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    mode: demo ? 'demo' : 'live',
    scope: 'Recorded activity in selected local profiles on this device; not account-wide billing.',
    providers: providers.map(provider => ({
      provider: provider.id, account: provider.accountLabel ?? 'Default local profile',
      fetchedAt: provider.fetchedAt ?? null, cached: provider.cached ?? false, quotaState: provider.quotaState ?? null, retryAt: provider.retryAt ?? null, metrics: provider.metrics,
      history: provider.history ?? null,
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
  const rows: unknown[][] = [['mode', 'provider', 'account', 'date', 'input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'total_tokens', 'partial', 'scope']];
  for (const provider of providers) {
    if (!provider.history?.available) continue;
    for (const day of provider.history.days) rows.push([
      demo ? 'demo' : 'live', provider.id, provider.accountLabel ?? 'Default local profile', day.date,
      day.inputTokens, day.cachedInputTokens, day.cacheWriteTokens, day.outputTokens, day.totalTokens,
      provider.history.partial, 'Selected local profile on this device; not account-wide billing',
    ]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
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
