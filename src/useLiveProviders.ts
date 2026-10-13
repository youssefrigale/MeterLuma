import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider, ProviderId, Settings, UsageHistory } from './model';

export interface LiveResult { id: ProviderId; provider?: Provider; error?: string; loading?: boolean }

export function useLiveProviders(settings: Settings) {
  const [results, setResults] = useState<LiveResult[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const ids = settings.liveProviders.filter(id => settings.enabled.includes(id)).join(',');
  useEffect(() => {
    if (settings.demo || !isTauri() || !ids) { setResults([]); setUpdatedAt(null); return; }
    let active = true;
    const providerIds = ids.split(',') as ProviderId[];
    setUpdatedAt(null);
    setResults(providerIds.map(id => ({ id, loading: true })));
    void Promise.all(providerIds.map(async id => {
      let result: LiveResult;
      const quotaRequest = invoke<Provider>('refresh_provider', { providerId: id });
      // Show account limits while the larger local histories are still being scanned.
      void quotaRequest.then(provider => { if (active) setResults(current => current.map(row => row.id === id ? { id, provider: { ...provider, historyLoading: true }, loading: true } : row)); }).catch(() => {});
      const [quota, activity] = await Promise.allSettled([
        quotaRequest,
        invoke<UsageHistory>('read_usage_history', { providerId: id }),
      ]);
      const history = activity.status === 'fulfilled' ? activity.value : undefined;
      const provider = quota.status === 'fulfilled' ? { ...quota.value, history } : history?.available ? {
        id, name: { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' }[id], plan: 'Local history', color: '#515157', initials: '', spendToday: null, metrics: [], history,
      } : undefined;
      result = { id, provider, ...(quota.status === 'rejected' ? { error: typeof quota.reason === 'string' ? quota.reason : 'Live allowances could not be fetched. Your local activity is shown when available.' } : {}) };
      if (active) setResults(current => current.map(row => row.id === id ? result : row));
      return result;
    })).then(results => {
      const fetched = results.flatMap(result => typeof result.provider?.fetchedAt === 'number' ? [result.provider.fetchedAt] : []);
      if (active) setUpdatedAt(fetched.length ? Math.min(...fetched) : null);
    });
    return () => { active = false; };
  }, [settings.demo, ids, request]);
  useEffect(() => {
    if (settings.demo || !isTauri() || !ids) { setNextRefreshAt(null); return; }
    const interval = Math.max(5, settings.refreshMinutes) * 60_000;
    setNextRefreshAt(Date.now() + interval);
    const timer = window.setTimeout(() => setRequest(current => current + 1), interval);
    return () => clearTimeout(timer);
  }, [settings.demo, ids, settings.refreshMinutes, request]);
  return { results, updatedAt, nextRefreshAt, loading: results.some(result => result.loading), refresh: () => setRequest(current => current + 1) };
}
