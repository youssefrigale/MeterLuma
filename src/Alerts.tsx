import { useState } from 'react';
import type { AlertRule, Provider, ProviderId, Settings } from './model';

export function activeAlerts(rules: AlertRule[], providers: Provider[], now: number, demo: boolean) {
  if (demo) return [];
  return rules.filter(rule => rule.enabled).flatMap(rule => providers.filter(provider => provider.id === rule.providerId && !provider.cached && (!provider.quotaState || provider.quotaState === 'live') && typeof provider.fetchedAt === 'number' && now - provider.fetchedAt <= 10 * 60_000).flatMap(provider =>
    provider.metrics.filter(metric => metric.usedPercent >= rule.threshold && (metric.resetAt === null || metric.resetAt > now)).map(metric => ({
      key: `${rule.key}:${provider.connectionKey ?? provider.id}:${metric.label}:${metric.resetAt ?? 'unknown'}`,
      message: `${provider.name}${provider.accountLabel ? ` · ${provider.accountLabel}` : ''}: ${metric.label} is ${metric.usedPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used (alert at ${rule.threshold}%).`,
    })),
  ));
}

export function UsageAlerts({ settings, providers, now }: { settings: Settings; providers: Provider[]; now: number }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const alerts = activeAlerts(settings.alerts, providers, now, settings.demo).filter(alert => !dismissed.includes(alert.key));
  if (!alerts.length) return null;
  return <section className="usage-alerts" aria-label="Usage alerts">{alerts.map(alert => <div className="notice" role="status" key={alert.key}><p>{alert.message}</p><button className="text-button" aria-label={`Dismiss ${alert.message}`} onClick={() => setDismissed(current => [...current, alert.key].slice(-100))}>Dismiss</button></div>)}</section>;
}

export function AlertSettings({ settings, update }: { settings: Settings; update: (value: Partial<Settings>) => void }) {
  const [providerId, setProviderId] = useState<ProviderId>('codex');
  const [threshold, setThreshold] = useState(80);
  return <section className="panel feature-panel"><h2>Custom usage alerts</h2><p>Free in-app alerts while MeterLuma is running. Alerts use fresh live quotas only, never demo values. Experimental provider connections must be signed in and returning quotas.</p>
    <form className="feature-form" onSubmit={event => { event.preventDefault(); if (settings.alerts.length >= 12) return; update({ alerts: [...settings.alerts, { key: crypto.randomUUID(), providerId, threshold, enabled: true }] }); }}>
      <label>Provider<select value={providerId} onChange={event => setProviderId(event.target.value as ProviderId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="cursor">Cursor</option></select></label>
      <label>Alert at % used<input type="number" min="1" max="100" required value={threshold} onChange={event => setThreshold(Number(event.target.value))}/></label><button className="button" disabled={settings.alerts.length >= 12}>Add alert</button>
    </form>
    <ul className="feature-rows">{settings.alerts.map(rule => <li key={rule.key}><label><input type="checkbox" checked={rule.enabled} onChange={() => update({ alerts: settings.alerts.map(row => row.key === rule.key ? { ...row, enabled: !row.enabled } : row) })}/>{rule.providerId} · {rule.threshold}% used</label><button className="text-button" aria-label={`Remove ${rule.providerId} ${rule.threshold}% alert`} onClick={() => update({ alerts: settings.alerts.filter(row => row.key !== rule.key) })}>Remove</button></li>)}</ul>
  </section>;
}
