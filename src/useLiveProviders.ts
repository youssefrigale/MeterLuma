import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider, ProviderId, Settings, UsageHistory } from './model';
import { LEGAL_VERSION } from './legal';
import { quotaFailure, type QuotaFailure } from './providerState';

export interface LiveResult { id: ProviderId; key: string; label?: string; provider?: Provider; error?: string; quotaFailure?: QuotaFailure; loading?: boolean }

export function useLiveProviders(settings: Settings) {
  const [results, setResults] = useState<LiveResult[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const sources = JSON.stringify([
    ...settings.liveProviders.filter(id => settings.enabled.includes(id)).map(id => ({ id, key: id, directory: null as string | null, label: settings.profiles.some(row => row.providerId === id) ? 'Default profile' : undefined })),
    ...settings.profiles.filter(row => settings.enabled.includes(row.providerId)).map(row => ({ id: row.providerId, key: row.key, directory: row.directory, label: row.label })),
  ]);
  const permitted = settings.legalVersion === LEGAL_VERSION;
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') { setResults([]); setUpdatedAt(null); return; }
    let active = true;
    const accounts = JSON.parse(sources) as { id: ProviderId; key: string; directory: string | null; label?: string }[];
    setUpdatedAt(null);
    setResults(accounts.map(row => ({ id: row.id, key: row.key, label: row.label, loading: true })));
    void Promise.all(accounts.map(async ({ id, key, directory, label }) => {
      const base = { id, key, label };
      const quotaRequest = invoke<Provider>('refresh_provider', { providerId: id, configDirectory: directory });
      void quotaRequest.then(provider => { if (active) setResults(current => current.map(row => row.key === key ? { ...base, provider: { ...provider, connectionKey: key, accountLabel: label, historyLoading: true }, loading: true } : row)); }).catch(() => {});
      const [quota, activity] = await Promise.allSettled([
        quotaRequest,
        invoke<UsageHistory>('read_usage_history', { providerId: id, configDirectory: directory, days: settings.historyDays }),
      ]);
      const history = activity.status === 'fulfilled' ? activity.value : undefined;
      const failure = quota.status === 'rejected' ? quotaFailure(quota.reason) : undefined;
      const data: Provider | undefined = quota.status === 'fulfilled' ? { ...quota.value, history } : failure?.lastSnapshot ? { ...failure.lastSnapshot, history, cached: true } : history?.available ? {
        id, name: { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' }[id], plan: 'Local history', color: '#515157', initials: '', spendToday: null, metrics: [], history,
      } : undefined;
      const errors = [failure?.message, activity.status === 'rejected' ? 'Recorded local history could not be read.' : undefined].filter((value): value is string => typeof value === 'string');
      const result: LiveResult = { ...base, quotaFailure: failure, provider: data ? { ...data, quotaState: failure?.code ?? 'live', retryAt: failure?.retryAt, connectionKey: key, accountLabel: label } : undefined, ...(errors.length ? { error: errors.join(' ') } : {}) };
      if (active) setResults(current => current.map(row => row.key === key ? result : row));
      return result;
    })).then(results => {
      const fetched = results.flatMap(result => !result.provider?.cached && typeof result.provider?.fetchedAt === 'number' ? [result.provider.fetchedAt] : []);
      if (active) setUpdatedAt(fetched.length ? Math.min(...fetched) : null);
    });
    return () => { active = false; };
  }, [settings.demo, sources, request, settings.historyDays, permitted]);
  const retryDeadline = Math.min(...results.flatMap(result => typeof result.quotaFailure?.retryAt === 'number' ? [result.quotaFailure.retryAt] : []));
  useEffect(() => {
    if (settings.demo || !isTauri() || !permitted || sources === '[]') { setNextRefreshAt(null); return; }
    const interval = Math.max(5, settings.refreshMinutes) * 60_000;
    const delay = Math.min(interval, Number.isFinite(retryDeadline) ? Math.max(1000, retryDeadline - Date.now() + 1000) : interval);
    setNextRefreshAt(Date.now() + delay);
    const timer = window.setTimeout(() => setRequest(current => current + 1), delay);
    return () => clearTimeout(timer);
  }, [settings.demo, sources, settings.refreshMinutes, request, permitted, retryDeadline]);
  return { results, updatedAt, nextRefreshAt, loading: results.some(result => result.loading), refresh: () => setRequest(current => current + 1) };
}
