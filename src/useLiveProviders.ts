import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider, ProviderId, Settings } from './model';

export interface LiveResult { id: ProviderId; provider?: Provider; error?: string; loading?: boolean }

export function useLiveProviders(settings: Settings) {
  const [results, setResults] = useState<LiveResult[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const ids = settings.liveProviders.filter(id => settings.enabled.includes(id)).join(',');
  useEffect(() => {
    if (settings.demo || !isTauri() || !ids) { setResults([]); return; }
    let active = true;
    const providerIds = ids.split(',') as ProviderId[];
    setResults(providerIds.map(id => ({ id, loading: true })));
    void Promise.all(providerIds.map(async id => {
      let result: LiveResult;
      try { result = { id, provider: await invoke<Provider>('refresh_provider', { providerId: id }) }; }
      catch (error) { result = { id, error: typeof error === 'string' ? error : 'This provider could not be refreshed.' }; }
      if (active) setResults(current => current.map(row => row.id === id ? result : row));
    })).then(() => { if (active) setUpdatedAt(Date.now()); });
    return () => { active = false; };
  }, [settings.demo, ids, request]);
  useEffect(() => {
    if (settings.demo || !ids) return;
    const timer = window.setInterval(() => setRequest(current => current + 1), Math.max(5, settings.refreshMinutes) * 60_000);
    return () => clearInterval(timer);
  }, [settings.demo, ids, settings.refreshMinutes]);
  return { results, updatedAt, loading: results.some(result => result.loading), refresh: () => setRequest(current => current + 1) };
}
