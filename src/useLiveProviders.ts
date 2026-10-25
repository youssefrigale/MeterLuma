import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider, ProviderId, Settings, UsageHistory } from './model';
import { LEGAL_VERSION } from './legal';
import { quotaFailure, type QuotaFailure } from './providerState';
import { neutralColors, providerNames } from './format';

export interface LiveResult { id: ProviderId; key: string; label?: string; provider?: Provider; error?: string; quotaFailure?: QuotaFailure; loading?: boolean }
type Account = { id: ProviderId; key: string; directory: string | null; label?: string; tokenMode?: boolean };

// Claude is history-only: MeterLuma never asks the native side for Claude quotas.
export const hasQuotas = (id: ProviderId) => id !== 'claude';
// Cursor token history is not recorded locally, so it is never requested.
export const hasHistory = (id: ProviderId) => id !== 'cursor';

export function useLiveProviders(settings: Settings) {
  const [results, setResults] = useState<LiveResult[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const lastStarted = useRef<number | null>(null);
  const pending = useRef(false);
  const tokenProviders = settings.tokenProviders ?? [];
  const sources = JSON.stringify([
    ...settings.liveProviders.filter(id => settings.enabled.includes(id)).map(id => ({ id, key: tokenProviders.includes(id) ? `token-${id}` : id, directory: null as string | null, tokenMode: tokenProviders.includes(id), label: tokenProviders.includes(id) ? 'Account token' : settings.profiles.some(row => row.providerId === id) ? 'Default profile' : undefined })),
    ...settings.profiles.filter(row => !row.paused && settings.enabled.includes(row.providerId) && !tokenProviders.includes(row.providerId)).map(row => ({ id: row.providerId, key: row.key, directory: row.directory, label: row.label })),
  ]);
  const permitted = settings.legalVersion === LEGAL_VERSION;
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') { pending.current = false; lastStarted.current = null; setResults([]); setUpdatedAt(null); return; }
    // Only the latest run may write results, so an older response never overwrites a newer one.
    let active = true;
    pending.current = true;
    lastStarted.current = Date.now();
    const accounts = JSON.parse(sources) as Account[];
    // Stale-while-revalidate: keep each key's last provider and history visible while it refreshes; drop removed keys.
    setResults(current => accounts.map(row => ({ ...current.find(result => result.key === row.key && result.id === row.id), id: row.id, key: row.key, label: row.label, loading: true })));
    void Promise.all(accounts.map(async ({ id, key, directory, label, tokenMode }) => {
      const base = { id, key, label };
      const name = providerNames[id];
      const quotaRequest = hasQuotas(id) ? invoke<Provider>('refresh_provider', { providerId: id, configDirectory: directory, ...(tokenMode ? { tokenMode: true } : {}) }) : undefined;
      const historyRequest = !tokenMode && hasHistory(id) ? invoke<UsageHistory>('read_usage_history', { providerId: id, configDirectory: directory, days: settings.historyDays }) : undefined;
      void quotaRequest?.then(provider => { if (active) setResults(current => current.map(row => row.key === key ? { ...row, provider: { ...provider, tokenOnly: tokenMode, name, color: neutralColors[id], history: row.provider?.history, historyLoading: !!historyRequest, quotaState: 'live', connectionKey: key, accountLabel: label } } : row)); }).catch(() => {});
      const [quota, activity] = await Promise.allSettled([quotaRequest ?? Promise.resolve(undefined), historyRequest ?? Promise.resolve(undefined)]);
      const history = activity.status === 'fulfilled' ? activity.value : undefined;
      const failure = quota.status === 'rejected' ? quotaFailure(quota.reason) : undefined;
      const live = quota.status === 'fulfilled' ? quota.value : undefined;
      const data: Provider | undefined = live ? { ...live, history } : failure?.lastSnapshot ? { ...failure.lastSnapshot, history, cached: true } : (!hasQuotas(id) && history) || history?.available ? {
        id, name, plan: 'Local history', color: neutralColors[id], initials: '', spendToday: null, metrics: [], history, historyOnly: !hasQuotas(id),
      } : undefined;
      const errors = [failure?.message, activity.status === 'rejected' ? 'Recorded local history could not be read.' : undefined].filter((value): value is string => typeof value === 'string');
      const result: LiveResult = { ...base, quotaFailure: failure, provider: data ? { ...data, tokenOnly: tokenMode, name, color: neutralColors[id], quotaState: hasQuotas(id) ? failure?.code ?? 'live' : undefined, retryAt: failure?.retryAt, connectionKey: key, accountLabel: label } : undefined, ...(errors.length ? { error: errors.join(' ') } : {}) };
      if (active) setResults(current => current.map(row => row.key === key ? result : row));
      return result;
    })).then(results => {
      const fetched = results.flatMap(result => !result.provider?.cached && typeof result.provider?.fetchedAt === 'number' ? [result.provider.fetchedAt] : []);
      const scanned = results.flatMap(result => typeof result.provider?.history?.scannedAt === 'number' ? [result.provider.history.scannedAt] : []);
      if (active) {
        pending.current = false;
        setUpdatedAt(fetched.length ? Math.min(...fetched) : scanned.length ? Math.max(...scanned) : null);
      }
    });
    return () => { active = false; };
  }, [settings.demo, sources, request, settings.historyDays, permitted]);
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') return;
    // A suspended WebView may resume before its overdue timeout fires. Opening
    // the panel should catch up immediately, without refetching fresh data.
    const resume = () => {
      if (document.visibilityState === 'hidden' || pending.current || lastStarted.current === null) return;
      const now = Date.now();
      const elapsed = now - lastStarted.current;
      if (elapsed < 0 || elapsed >= Math.max(5, settings.refreshMinutes) * 60_000) {
        // Focus and visibility can arrive together, before React processes the request.
        lastStarted.current = now;
        setRequest(current => current + 1);
      }
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [settings.demo, sources, settings.refreshMinutes, permitted]);
  // Keep a settled retry scheduled when a clock tick or navigation renders after its
  // deadline. Once a new lookup starts, deadlines from before that lookup are spent.
  const retryDeadline = Math.min(...results.flatMap(result => !result.loading && typeof result.quotaFailure?.retryAt === 'number' && result.quotaFailure.retryAt > (lastStarted.current ?? 0) ? [result.quotaFailure.retryAt] : []));
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') { setNextRefreshAt(null); return; }
    const interval = Math.max(5, settings.refreshMinutes) * 60_000;
    const delay = Math.min(interval, Number.isFinite(retryDeadline) ? Math.max(1000, retryDeadline - Date.now() + 1000) : interval);
    setNextRefreshAt(Date.now() + delay);
    const timer = window.setTimeout(() => setRequest(current => current + 1), delay);
    return () => clearTimeout(timer);
  }, [settings.demo, sources, settings.refreshMinutes, request, permitted, retryDeadline]);
  return { results, updatedAt, nextRefreshAt, loading: results.some(result => result.loading), refresh: () => setRequest(current => current + 1), tokenChanged: (id: ProviderId) => { setResults(current => current.filter(row => row.id !== id)); setRequest(current => current + 1); } };
}
