import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { Provider, ProviderId, Settings, UsageHistory } from './model';
import { hasClaudeUsageConsent, hasProviderConsent } from './legal';
import { quotaFailure, type QuotaFailure } from './providerState';
import { neutralColors, providerNames } from './format';
import { nativeLookup } from './nativeLookup';
import { useUsageResume } from './useUsageResume';
import { providerConnections, type ProviderConnection as Account } from './providerConnections';

export interface LiveResult { id: ProviderId; key: string; label?: string; provider?: Provider; error?: string; quotaFailure?: QuotaFailure; loading?: boolean; historyLoading?: boolean }

export const hasQuotas = (id: ProviderId, settings: Settings) => id !== 'claude' || hasClaudeUsageConsent(settings);
// Cursor token history is not recorded locally, so it is never requested.
export const hasHistory = (id: ProviderId) => id !== 'cursor';

function historyProvider(id: ProviderId, history: UsageHistory | undefined, settings: Settings, quotaLoading = false): Provider | undefined {
  if (!history || (hasQuotas(id, settings) && !history.available)) return undefined;
  return { id, name: providerNames[id], plan: 'Local history', color: neutralColors[id], initials: '', spendToday: null, metrics: [], history, historyOnly: !hasQuotas(id, settings), ...(quotaLoading ? { quotaLoading } : {}) };
}

export function useLiveProviders(settings: Settings) {
  const [results, setResults] = useState<LiveResult[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const lastStarted = useRef<number | null>(null);
  const pending = useRef(false);
  const forceRefresh = useRef(false);
  const sources = JSON.stringify(providerConnections(settings));
  const permitted = hasProviderConsent(settings);
  const claudeLive = hasClaudeUsageConsent(settings);
  const claudeAccounts = claudeLive ? (JSON.parse(sources) as Account[]).filter(account => account.id === 'claude') : [];
  const claudeResults = results.filter(row => claudeAccounts.some(account => account.key === row.key));
  const claudePolling = claudeAccounts.length > 0 && (!claudeResults.length || claudeResults.some(row => row.quotaFailure?.code !== 'rate_limited'));
  const lowSession = claudeResults.some(row => !row.quotaFailure && row.provider?.metrics.some(metric => metric.label === 'Session' && metric.usedPercent >= 75 && metric.usedPercent < 100));
  const interval = claudePolling ? lowSession ? 30_000 : 60_000 : Math.max(5, settings.refreshMinutes) * 60_000;
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') { pending.current = false; lastStarted.current = null; setResults([]); setUpdatedAt(null); return; }
    // Only the latest run may write results, so an older response never overwrites a newer one.
    let active = true;
    pending.current = true;
    lastStarted.current = Date.now();
    const fresh = forceRefresh.current;
    forceRefresh.current = false;
    const accounts = JSON.parse(sources) as Account[];
    // Stale-while-revalidate: keep each key's last provider and history visible while it refreshes; drop removed keys.
    setResults(current => accounts.map(row => ({ ...current.find(result => result.key === row.key && result.id === row.id), id: row.id, key: row.key, label: row.label, loading: true, historyLoading: !row.tokenMode && hasHistory(row.id) })));
    void Promise.all(accounts.map(async ({ id, key, directory, label, tokenMode }) => {
      const base = { id, key, label };
      const name = providerNames[id];
      const quotaRequest = hasQuotas(id, settings) ? nativeLookup<Provider>('refresh_provider', { providerId: id, configDirectory: directory, forceRefresh: fresh, ...(id === 'claude' ? { claudeLive: true } : {}), ...(tokenMode ? { tokenMode: true } : {}) }) : undefined;
      const historyRequest = !tokenMode && hasHistory(id) ? nativeLookup<UsageHistory>('read_usage_history', { providerId: id, configDirectory: directory, days: settings.historyDays }) : undefined;
      // Each lookup publishes independently; a slow quota request must not hide completed history.
      void quotaRequest?.then(provider => { if (active) setResults(current => current.map(row => row.key === key ? { ...row, provider: { ...provider, tokenOnly: tokenMode, name, color: neutralColors[id], history: row.provider?.history, historyLoading: row.historyLoading, quotaState: 'live', connectionKey: key, accountLabel: label } } : row)); }, () => { /* Quota failures are reported by the settled result below. */ });
      void historyRequest?.then(history => {
        if (active) setResults(current => current.map(row => {
          if (row.key !== key) return row;
          // History can arrive first; until the quota lookup settles its limits are still being read.
          const provider = row.provider ?? historyProvider(id, history, settings, !!quotaRequest);
          return { ...row, historyLoading: false, provider: provider ? { ...provider, history, historyLoading: false, connectionKey: key, accountLabel: label } : undefined };
        }));
      }, () => {
        if (active) setResults(current => current.map(row => row.key === key ? { ...row, historyLoading: false, error: 'Recorded local history could not be read.', provider: row.provider ? { ...row.provider, historyLoading: false } : undefined } : row));
      });
      const [quota, activity] = await Promise.allSettled([quotaRequest ?? Promise.resolve(undefined), historyRequest ?? Promise.resolve(undefined)]);
      const history = activity.status === 'fulfilled' ? activity.value : undefined;
      const failure = quota.status === 'rejected' ? quotaFailure(quota.reason) : undefined;
      const live = quota.status === 'fulfilled' ? quota.value : undefined;
      const data: Provider | undefined = live ? { ...live, history } : failure?.lastSnapshot ? { ...failure.lastSnapshot, history, cached: true } : historyProvider(id, history, settings);
      const errors = [failure?.message, activity.status === 'rejected' ? 'Recorded local history could not be read.' : undefined].filter((value): value is string => typeof value === 'string');
      const result: LiveResult = { ...base, quotaFailure: failure, provider: data ? { ...data, tokenOnly: tokenMode, name, color: neutralColors[id], quotaState: hasQuotas(id, settings) ? failure?.code ?? 'live' : undefined, retryAt: failure?.retryAt, connectionKey: key, accountLabel: label } : undefined, ...(errors.length ? { error: errors.join(' ') } : {}) };
      if (active) setResults(current => current.map(row => row.key === key ? result : row));
      return result;
    })).then(results => {
      const fetched = results.flatMap(result => !result.provider?.cached && typeof result.provider?.fetchedAt === 'number' ? [result.provider.fetchedAt] : []);
      const scanned = results.flatMap(result => typeof result.provider?.history?.scannedAt === 'number' ? [result.provider.history.scannedAt] : []);
      if (active) setUpdatedAt(fetched.length ? Math.min(...fetched) : scanned.length ? Math.max(...scanned) : null);
    }).catch(() => {
      // A defect while settling one lookup must not leave rows loading or block later refreshes.
      if (active) setResults(current => current.map(row => row.loading ? { ...row, loading: false, historyLoading: false, error: row.error ?? 'Usage could not be read. Try refreshing.', provider: row.provider ? { ...row.provider, historyLoading: false, quotaLoading: false } : undefined } : row));
    }).finally(() => { if (active) pending.current = false; });
    return () => { active = false; };
  }, [settings.demo, sources, request, settings.historyDays, permitted, claudeLive]);
  useUsageResume({ enabled: isTauri() && !settings.demo && permitted && sources !== '[]', intervalMs: interval, nextRefreshAt, lastStarted, pending, refresh: () => setRequest(current => current + 1) });
  // Keep a settled retry scheduled when a clock tick or navigation renders after its
  // deadline. Once a new lookup starts, deadlines from before that lookup are spent.
  const retryDeadline = Math.min(...results.flatMap(result => !result.loading && typeof result.quotaFailure?.retryAt === 'number' && result.quotaFailure.retryAt > (lastStarted.current ?? 0) ? [result.quotaFailure.retryAt] : []));
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') { setNextRefreshAt(null); return; }
    const due = (lastStarted.current ?? Date.now()) + interval;
    const delay = Math.max(1000, Math.min(due, Number.isFinite(retryDeadline) ? retryDeadline + 1000 : due) - Date.now());
    setNextRefreshAt(Date.now() + delay);
    const poll = () => {
      if (pending.current) { timer = window.setTimeout(poll, 1000); return; }
      setRequest(current => current + 1);
    };
    let timer = window.setTimeout(poll, delay);
    return () => clearTimeout(timer);
  }, [settings.demo, sources, interval, request, permitted, retryDeadline]);
  return { results, updatedAt, nextRefreshAt, loading: results.some(result => result.loading), refresh: () => { if (pending.current) return; forceRefresh.current = true; setRequest(current => current + 1); }, tokenChanged: (id: ProviderId) => { setResults(current => current.filter(row => row.id !== id)); setRequest(current => current + 1); } };
}
