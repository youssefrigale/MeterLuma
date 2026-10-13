import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Icon, Mark } from './icons';
import { readSettings, sampleProviders, countdown, dailySpend, money, SETTINGS_KEY } from './model';
import { useLiveProviders } from './useLiveProviders';

type Range = 'Today' | 'Yesterday' | '30 Days';
const colors = { claude: '#e9b56d', codex: '#87cbb3', cursor: '#aaa2e8' };

export default function QuickView() {
  const [settings, setSettings] = useState(readSettings);
  const [anchor] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [refreshed, setRefreshed] = useState(Date.now);
  const [range, setRange] = useState<Range>('Today');
  const [options, setOptions] = useState(false);
  const [info, setInfo] = useState(false);
  const [error, setError] = useState('');
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsMenu = useRef<HTMLDivElement>(null);
  const live = useLiveProviders(settings);
  const providers = settings.demo ? sampleProviders(anchor).filter(provider => settings.enabled.includes(provider.id)) : live.results.flatMap(result => result.provider ? [result.provider] : []);
  const costs = settings.demo ? providers.map(provider => {
    const history = dailySpend[provider.id];
    // Thirty explicitly simulated days; no real spending history is inferred from quotas.
    const thirtyDays = [...history, ...history, ...history].slice(-30);
    return { ...provider, cost: range === 'Today' ? provider.spendToday! : range === 'Yesterday' ? history.at(-2)! : thirtyDays.reduce((sum, value) => sum + value, 0) };
  }) : [];
  const total = costs.reduce((sum, provider) => sum + provider.cost, 0);
  const interval = (settings.demo ? settings.refreshMinutes : Math.max(5, settings.refreshMinutes)) * 60_000;
  const nextRefresh = Math.max(1, Math.ceil((interval - (now - refreshed) % interval) / 60_000));

  useEffect(() => {
    document.documentElement.classList.add('tray-panel');
    const sync = (event: StorageEvent) => { if (event.key === SETTINGS_KEY) setSettings(readSettings()); };
    window.addEventListener('storage', sync);
    return () => { document.documentElement.classList.remove('tray-panel'); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = settings.theme === 'system' ? media.matches ? 'dark' : 'light' : settings.theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!options) return;
    optionsMenu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!optionsMenu.current?.contains(event.target as Node) && !optionsButton.current?.contains(event.target as Node)) setOptions(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [options]);
  useEffect(() => {
    if (!isTauri()) return;
    const limits = providers.map(provider => `${provider.name} ${Math.round(Math.max(0, 100 - (provider.metrics[0]?.usedPercent ?? 100)))}% left`).join(' · ');
    void invoke('set_tray_summary', { summary: `${settings.demo ? 'Demo · ' : ''}${limits || 'Choose your providers in Options'}` }).catch(() => {});
  }, [settings.demo, providers.map(provider => `${provider.id}:${provider.metrics[0]?.usedPercent}`).join(',')]);

  async function openDashboard(page: 'dashboard' | 'settings' | 'connections' = 'dashboard') {
    setOptions(false);
    if (!isTauri()) { window.location.href = `/?page=${page}`; return; }
    try { await invoke('show_dashboard', { page }); }
    catch { setError('The requested window could not be opened.'); }
  }
  function refresh() { live.refresh(); setRefreshed(Date.now()); setNow(Date.now()); setOptions(false); }

  let offset = 0;
  return <main className="quick-view" aria-label="MeterLuma usage panel">
    <div className="quick-scroll" tabIndex={0} aria-label="Costs and provider allowances">
      <header className="quick-header"><div className="quick-brand"><Mark size={30}/><div><h1>Meter<span>Luma</span></h1><p>Your AI, at a glance.</p></div></div><button className="quick-refresh" aria-label="Refresh usage" disabled={live.loading} onClick={refresh}><Icon name="refresh" size={15}/></button></header>
      <div className="quick-section-label"><h2>Cost</h2><button className="quick-info-button" aria-label="About cost data" aria-expanded={info} onClick={() => setInfo(value => !value)}><Icon name="info" size={13}/></button><span className="quick-mode">{settings.demo ? 'Demo' : 'Live'}</span></div>
      {info && <p className="quick-info">{settings.demo ? 'This preview uses simulated USD costs and allowances. These are not your bills.' : 'Live connections currently report allowances only. Costs and spending history are not available yet.'}</p>}
      <section className="quick-cost" aria-label="Provider costs">
        <div className="quick-tabs" aria-label="Cost date range">{(['Today', 'Yesterday', '30 Days'] as const).map(value => <button key={value} aria-pressed={range === value} className={range === value ? 'selected' : ''} onClick={() => setRange(value)}>{value}</button>)}</div>
        {costs.length > 0 ? <div className="quick-cost-content"><div className="quick-donut" role="img" aria-label={`${range} simulated costs: ${money(total)}`}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="quick-donut-track" cx="60" cy="60" r="48"/>{costs.map(provider => {
            const fraction = total ? provider.cost / total * 100 : 0;
            const start = offset; offset += fraction;
            return <circle key={provider.id} cx="60" cy="60" r="48" pathLength="100" fill="none" stroke={colors[provider.id]} strokeWidth="12" strokeDasharray={`${Math.max(0, fraction - 1.7)} ${100 - Math.max(0, fraction - 1.7)}`} strokeDashoffset={-start} transform="rotate(-90 60 60)"/>;
          })}</svg><div><strong>{money(total)}</strong><span>USD · sample</span></div>
        </div><ul className="quick-cost-legend">{costs.map(provider => <li key={provider.id}><i style={{ background: colors[provider.id] }}/><span>{provider.name}</span><strong>{money(provider.cost)}</strong></li>)}</ul></div> : <div className="quick-cost-empty"><Icon name="info" size={19}/><p><span>{settings.demo ? 'Enable a provider to preview costs.' : 'Cost data unavailable'}</span><small>{settings.demo ? 'Choose providers in Options.' : 'Live plan limits appear below.'}</small></p></div>}
      </section>
      <div className="quick-limits-label"><h2>Allowances</h2><span>{providers.length} providers</span></div>
      <div className="quick-providers">{providers.map(provider => <article className="quick-provider" key={provider.id} style={{ '--provider-color': colors[provider.id] } as CSSProperties}>
        <div className="quick-provider-heading"><span className="quick-provider-logo" aria-hidden="true">{provider.initials}</span><h2>{provider.name}</h2><span>{provider.plan}</span></div>
        <div className="quick-metrics">{provider.metrics.map(metric => {
          const remaining = Math.max(0, 100 - Math.min(100, metric.usedPercent));
          const reset = countdown(metric.resetAt, now);
          return <div className="quick-metric" key={metric.label}><div className="quick-metric-title"><h3>{metric.label}</h3><span><strong>{remaining.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</strong> left</span></div><div className="quick-meter" role="progressbar" aria-label={`${provider.name} ${metric.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}><span style={{ width: `${remaining}%` }}/></div><div className="quick-metric-caption"><Icon name="clock" size={11}/><span>{metric.resetAt === null || reset === 'Reset due' ? reset : `Resets in ${reset}`}</span></div></div>;
        })}</div>
      </article>)}</div>
      {!settings.demo && live.results.filter(result => result.loading || result.error).map(result => <p className="quick-info" role="status" key={result.id}>{result.loading ? `Fetching ${result.id}…` : result.error}</p>)}
      {!providers.length && !live.loading && <div className="quick-empty"><p>Keep your allowances in view.</p><button onClick={() => void openDashboard('connections')}>Choose providers <Icon name="arrow" size={14}/></button></div>}
      {error && <p role="status" className="quick-info">{error}</p>}
    </div>
    <footer className="quick-footer"><div><span className="quick-status"><i/>{settings.demo ? 'Sample data only' : live.updatedAt ? `Fetched ${new Date(live.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live plan limits'}</span><small>v0.1.0 · Next update in {nextRefresh}m</small></div><button className="quick-options-button" ref={optionsButton} aria-haspopup="menu" aria-expanded={options} aria-controls="quick-options" onClick={() => setOptions(value => !value)}>Options <Icon name="chevron" size={13}/></button></footer>
    {options && <div id="quick-options" className="quick-options" role="menu" aria-label="Options" ref={optionsMenu} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOptions(false); optionsButton.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(optionsMenu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}><button role="menuitem" onClick={refresh}><Icon name="refresh" size={15}/>Refresh now</button><button role="menuitem" onClick={() => void openDashboard('connections')}><Icon name="link" size={15}/>Connections</button><button role="menuitem" onClick={() => void openDashboard('settings')}><Icon name="settings" size={15}/>Settings</button><button role="menuitem" onClick={() => void openDashboard()}><Icon name="grid" size={15}/>Open dashboard</button>{isTauri() && <><hr/><button role="menuitem" onClick={() => void invoke('quit_app').catch(() => setError('MeterLuma could not quit.'))}><Icon name="close" size={15}/>Quit MeterLuma</button></>}</div>}
  </main>;
}
