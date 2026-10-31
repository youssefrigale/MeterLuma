import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { Settings } from '../model';
import { hasProviderConsent } from '../legal';
import { nativeLookup } from '../nativeLookup';
import { useUsageResume } from '../useUsageResume';
import { additionalConnections, additionalProvider, type AdditionalResult, type AdditionalSnapshot } from './model';

export function snapshotFromNative(raw: unknown, id: string): AdditionalSnapshot {
  const snapshot = raw as AdditionalSnapshot | null;
  if (!snapshot || snapshot.id !== id || typeof snapshot.name !== 'string' || snapshot.name.length > 120 || !Number.isFinite(snapshot.fetchedAt) || snapshot.fetchedAt < 0 || typeof snapshot.cached !== 'boolean' || !(snapshot.plan === null || typeof snapshot.plan === 'string') || !(snapshot.notice === null || typeof snapshot.notice === 'string') || !Array.isArray(snapshot.metrics) || !Array.isArray(snapshot.amounts)
      || snapshot.metrics.length > 32 || snapshot.amounts.length > 64 || snapshot.metrics.length + snapshot.amounts.length === 0 || !(snapshot.warning === undefined || typeof snapshot.warning === 'boolean')
      || (snapshot.plan?.length ?? 0) > 120 || (snapshot.notice?.length ?? 0) > 1000
      || !snapshot.metrics.every(metric => !!metric && typeof metric.label === 'string' && metric.label.length <= 100 && Number.isFinite(metric.usedPercent) && metric.usedPercent >= 0 && (metric.resetAt === null || Number.isFinite(metric.resetAt)))
      || !snapshot.amounts.every(amount => !!amount && typeof amount.label === 'string' && amount.label.length <= 100 && Number.isFinite(amount.value) && typeof amount.unit === 'string' && amount.unit.length <= 32 && (amount.currency === null || /^[A-Z]{3}$/.test(amount.currency)))) {
    throw new Error('The provider returned an unsupported usage snapshot.');
  }
  return snapshot;
}
function failure(reason: unknown) {
  const failure = reason as { message?: unknown; retryAt?: unknown; lastSnapshot?: unknown } | null;
  return { message: typeof failure?.message === 'string' ? failure.message : typeof reason === 'string' ? reason : 'Usage could not be read. Try refreshing.', retryAt: typeof failure?.retryAt === 'number' && Number.isFinite(failure.retryAt) ? failure.retryAt : undefined, snapshot: failure?.lastSnapshot };
}

export function useAdditionalProviders(settings: Settings) {
  const [results, setResults] = useState<AdditionalResult[]>([]);
  const [request, setRequest] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const lastStarted = useRef<number | null>(null); const pending = useRef(false);
  const sources = JSON.stringify(additionalConnections(settings.additionalConnections).filter(connection => connection.enabled !== false && additionalProvider(connection.id)?.state === 'ready'));
  const permitted = hasProviderConsent(settings);
  useEffect(() => {
    if (!isTauri() || settings.demo || !permitted || sources === '[]') { pending.current = false; lastStarted.current = null; setResults([]); return; }
    let active = true;
    pending.current = true; lastStarted.current = Date.now();
    const connections = additionalConnections(JSON.parse(sources));
    setResults(current => connections.map(connection => ({ ...current.find(result => result.id === connection.id), id: connection.id, label: connection.label, loading: true })));
    void Promise.all(connections.map(connection => nativeLookup<unknown>('refresh_additional_provider', { providerId: connection.id }).then(raw => {
        const snapshot = snapshotFromNative(raw, connection.id);
        if (active) setResults(current => current.map(result => result.id === connection.id ? { id: connection.id, label: connection.label, snapshot } : result));
      }).catch(reason => {
        if (!active) return;
        const rejected = failure(reason);
        let snapshot: AdditionalSnapshot | undefined;
        if (rejected.snapshot) { try { snapshot = { ...snapshotFromNative(rejected.snapshot, connection.id), cached: true }; } catch { /* Invalid cached data is discarded; the request failure remains visible. */ } }
        setResults(current => current.map(result => result.id === connection.id ? { id: connection.id, label: connection.label, error: rejected.message, retryAt: rejected.retryAt, snapshot } : result));
      }))).then(() => { if (active) pending.current = false; });
    return () => { active = false; };
  }, [sources, request, settings.demo, permitted]);
  useUsageResume({ enabled: isTauri() && !settings.demo && permitted && sources !== '[]', intervalMs: Math.max(5, settings.refreshMinutes) * 60_000, nextRefreshAt, lastStarted, pending, refresh: () => setRequest(request => request + 1) });
  const retry = Math.min(...results.flatMap(result => !result.loading && result.retryAt && result.retryAt > (lastStarted.current ?? 0) ? [result.retryAt] : []));
  useEffect(() => {
    if (!isTauri() || settings.demo || !permitted || sources === '[]') { setNextRefreshAt(null); return; }
    const interval = Math.max(5, settings.refreshMinutes) * 60_000;
    const deadline = Date.now() + (Number.isFinite(retry) ? Math.max(1000, retry - Date.now() + 1000) : interval);
    setNextRefreshAt(deadline);
    const timer = window.setTimeout(() => setRequest(request => request + 1), deadline - Date.now());
    return () => window.clearTimeout(timer);
  }, [sources, settings.demo, settings.refreshMinutes, permitted, request, retry]);
  return { results, nextRefreshAt, loading: results.some(result => result.loading), refresh: () => setRequest(request => request + 1) };
}
