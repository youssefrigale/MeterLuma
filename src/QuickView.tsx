import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Mark, Icon } from './icons';
import { readSettings, sampleProviders, countdown, SETTINGS_KEY } from './model';
import { useLiveProviders } from './useLiveProviders';

export default function QuickView() {
  const [settings, setSettings] = useState(readSettings);
  const [anchor] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState('');
  const live = useLiveProviders(settings);
  const providers = settings.demo ? sampleProviders(anchor).filter(provider => settings.enabled.includes(provider.id)) : live.results.flatMap(result => result.provider ? [result.provider] : []);

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SETTINGS_KEY) setSettings(readSettings()); };
    window.addEventListener('storage', sync);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = settings.theme === 'system' ? media.matches ? 'dark' : 'light' : settings.theme; };
    apply(); media.addEventListener('change', apply);
    return () => { window.removeEventListener('storage', sync); media.removeEventListener('change', apply); };
  }, [settings.theme]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

  async function openDashboard() {
    if (!isTauri()) { window.location.href = '/'; return; }
    try { await invoke('show_dashboard'); }
    catch { setError('The dashboard could not be opened.'); }
  }

  return <main className="quick-view">
    <header className="quick-header"><div className="brand"><Mark size={29}/><span>Meter<span className="brand-luma">Luma</span></span></div><span className="demo-badge"><span/>{settings.demo ? 'Demo' : 'Live'}</span></header>
    <div className="quick-intro"><p className="eyebrow">YOUR DAILY HEADROOM</p><h1>A little room to create.</h1></div>
    <div className="quick-providers">{providers.map(provider => <article className="quick-provider" key={provider.id} style={{ '--provider-color': provider.color } as React.CSSProperties}>
      <div className="quick-provider-heading"><span className={`provider-logo ${provider.id}`}>{provider.initials}</span><h2>{provider.name}</h2><span>{provider.plan}</span></div>
      {provider.metrics.map(metric => <div className="quick-metric" key={metric.label}><div><span>{metric.label}</span><strong>{Math.max(0, 100 - metric.usedPercent).toLocaleString(undefined, { maximumFractionDigits: 1 })}% left</strong></div><div className="meter" role="progressbar" aria-label={`${provider.name} ${metric.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, 100 - Math.min(100, metric.usedPercent))}><span style={{ width: `${Math.max(0, 100 - Math.min(100, metric.usedPercent))}%` }}/></div><small>{metric.resetAt === null ? 'Reset time unavailable' : countdown(metric.resetAt, now) === 'Reset due' ? 'Reset due' : `Resets in ${countdown(metric.resetAt, now)}`}</small></div>)}
    </article>)}</div>
    {!settings.demo && live.results.filter(result => result.loading || result.error).map(result => <div className="notice compact" key={result.id}><Icon name="info"/><p>{result.loading ? `Fetching ${result.id}…` : result.error}</p></div>)}
    {!providers.length && !live.loading && <div className="notice compact"><Icon name="link"/><p>Choose your providers in the dashboard to get started.</p></div>}
    <footer className="quick-footer"><span><span className="tiny-dot"/>{settings.demo ? 'Sample data only' : 'Live plan limits'}</span><button className="text-button" onClick={() => void openDashboard()}>Open dashboard <Icon name="arrow" size={15}/></button></footer>
    {error && <p role="status" className="footnote">{error}</p>}
  </main>;
}
