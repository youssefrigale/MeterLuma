import { useEffect, useState } from 'react';
import type { AlertRule, Provider, ProviderId, Settings } from './model';
import { providerNames } from './format';

export const DISMISSALS_KEY = 'meterluma.alert-dismissals.v1';
// A quota stays fresh until shortly after the next scheduled refresh, and never less than 10 minutes.
export const alertFreshness = (refreshMinutes: number) => Math.max(10, Math.max(5, refreshMinutes) + 2) * 60_000;

export function activeAlerts(rules: AlertRule[], providers: Provider[], now: number, demo: boolean, refreshMinutes = 5) {
  if (demo) return [];
  return rules.filter(rule => rule.enabled).flatMap(rule => providers.filter(provider => provider.id === rule.providerId && !provider.cached && !provider.historyOnly && (!provider.quotaState || provider.quotaState === 'live') && typeof provider.fetchedAt === 'number' && now - provider.fetchedAt <= alertFreshness(refreshMinutes)).flatMap(provider =>
    provider.metrics.filter(metric => metric.usedPercent >= rule.threshold && (metric.resetAt === null || metric.resetAt > now)).map(metric => ({
      // Reset times are rounded to the minute so small timestamp jitter does not resurrect a dismissed alert.
      key: `${rule.key}:${provider.connectionKey ?? provider.id}:${metric.label}:${metric.resetAt === null ? 'unknown' : Math.round(metric.resetAt / 60_000)}`,
      message: `${provider.name}${provider.accountLabel ? ` · ${provider.accountLabel}` : ''}: ${metric.label} is ${metric.usedPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used (alert at ${rule.threshold}%).`,
    })),
  ));
}

function readDismissed(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(DISMISSALS_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string').slice(-100) : []; }
  catch { return []; }
}

export function UsageAlerts({ settings, providers, now }: { settings: Settings; providers: Provider[]; now: number }) {
  // Shared through localStorage so a dismissal applies to both windows and survives restarts.
  const [dismissed, setDismissed] = useState(readDismissed);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === DISMISSALS_KEY || event.key === null) setDismissed(readDismissed()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function dismiss(key: string) {
    const next = [...dismissed.filter(value => value !== key), key].slice(-100);
    setDismissed(next);
    try { localStorage.setItem(DISMISSALS_KEY, JSON.stringify(next)); } catch { /* The dismissal still applies to this window. */ }
  }
  const alerts = activeAlerts(settings.alerts, providers, now, settings.demo, settings.refreshMinutes).filter(alert => !dismissed.includes(alert.key));
  if (!alerts.length) return null;
  return <section className="usage-alerts" aria-label="Usage alerts">{alerts.map(alert => <div className="notice" role="status" key={alert.key}><p>{alert.message}</p><button className="text-button" aria-label={`Dismiss ${alert.message}`} onClick={() => dismiss(alert.key)}>Dismiss</button></div>)}</section>;
}

export function AlertSettings({ settings, update }: { settings: Settings; update: (value: Partial<Settings>) => void }) {
  const [providerId, setProviderId] = useState<ProviderId>('codex');
  const [threshold, setThreshold] = useState(80);
  return <section className="panel feature-panel"><h2>Custom usage alerts</h2><p>Free in-app alerts while MeterLuma is running. Alerts use fresh Codex or Cursor quotas only, never cached or demo values. Claude has no quotas in MeterLuma, so it has no alerts.</p>
    <form className="feature-form" onSubmit={event => { event.preventDefault(); if (settings.alerts.length >= 12) return; update({ alerts: [...settings.alerts, { key: crypto.randomUUID(), providerId, threshold, enabled: true }] }); }}>
      <label>Provider<select value={providerId} onChange={event => setProviderId(event.target.value as ProviderId)}><option value="codex">Codex</option><option value="cursor">Cursor</option></select></label>
      <label>Alert at % used<input type="number" min="1" max="100" required value={threshold} onChange={event => setThreshold(Number(event.target.value))}/></label><button className="button" disabled={settings.alerts.length >= 12}>Add alert</button>
    </form>
    <ul className="feature-rows">{settings.alerts.map(rule => <li key={rule.key}><label><input type="checkbox" checked={rule.enabled} onChange={() => update({ alerts: settings.alerts.map(row => row.key === rule.key ? { ...row, enabled: !row.enabled } : row) })}/>{providerNames[rule.providerId]} · {rule.threshold}% used</label><button className="text-button" aria-label={`Remove ${providerNames[rule.providerId]} ${rule.threshold}% alert`} onClick={() => update({ alerts: settings.alerts.filter(row => row.key !== rule.key) })}>Remove</button></li>)}</ul>
  </section>;
}
