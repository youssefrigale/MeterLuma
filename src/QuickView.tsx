import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Icon, Mark } from './icons';
import { readSettings, sampleProviders, dailySpend, money, SETTINGS_KEY, type Settings, type ProviderId } from './model';
import { useLiveProviders } from './useLiveProviders';
import { QuickSettings } from './QuickSettings';
import { QuickProvider, colors, thirtyDaySpend } from './QuickProvider';
import { ProviderLogo } from './ProviderLogo';
import { LicenseGate } from './LegalNotice';
import { UsageAlerts } from './Alerts';
import { retryCountdown } from './providerState';

type View = 'overview' | 'costs' | 'settings' | 'help' | ProviderId;
type Range = 'Today' | 'Yesterday' | '30 Days';

export default function QuickView() {
  const [settings, setSettings] = useState(readSettings);
  const [anchor] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [refreshed, setRefreshed] = useState(Date.now);
  const [view, setView] = useState<View>('overview');
  const [profileKey, setProfileKey] = useState('');
  const [range, setRange] = useState<Range>('Today');
  const [options, setOptions] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsMenu = useRef<HTMLDivElement>(null);
  const live = useLiveProviders(settings);
  const catalog = sampleProviders(anchor);
  const providers = (settings.demo ? catalog.filter(provider => settings.enabled.includes(provider.id)) : live.results.flatMap(result => result.provider ? [result.provider] : [])).sort((a, b) => settings.providerOrder.indexOf(a.id) - settings.providerOrder.indexOf(b.id));
  const navigationProviders = settings.providerOrder.flatMap(id => settings.enabled.includes(id) ? catalog.filter(provider => provider.id === id) : []);
  const details = providers.filter(provider => provider.id === view);
  const detail = details.find(provider => provider.connectionKey === profileKey) ?? details[0];
  const isProviderView = ['claude', 'codex', 'cursor'].includes(view);
  const displayedFetchedAt = isProviderView ? detail?.fetchedAt : live.updatedAt;
  const costs = settings.demo ? providers.map(provider => ({ ...provider, cost: range === 'Today' ? provider.spendToday! : range === 'Yesterday' ? dailySpend[provider.id].at(-2)! : thirtyDaySpend(provider.id) })) : [];
  const total = costs.reduce((sum, provider) => sum + provider.cost, 0);
  const interval = Math.max(5, settings.refreshMinutes) * 60_000;
  const nextRefresh = settings.demo ? Math.max(1, Math.ceil((interval - (now - refreshed) % interval) / 60_000)) : live.nextRefreshAt ? Math.max(1, Math.ceil((live.nextRefreshAt - now) / 60_000)) : null;

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
  useEffect(() => { if (isProviderView && !settings.enabled.includes(view as ProviderId)) setView('overview'); }, [settings.enabled, view, isProviderView]);
  useEffect(() => { scroll.current?.scrollTo(0, 0); setOptions(false); }, [view]);
  useEffect(() => {
    if (!isTauri()) return;
    const height = view === 'costs' || view === 'help' ? 420 : 660;
    void invoke('resize_quick', { height }).catch(() => setError('The panel could not be resized.'));
  }, [view, isProviderView, detail?.id]);
  useEffect(() => {
    if (!options) return;
    optionsMenu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!optionsMenu.current?.contains(event.target as Node) && !optionsButton.current?.contains(event.target as Node)) setOptions(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [options]);
  useEffect(() => {
    if (!isTauri()) return;
    const limits = providers.filter(provider => provider.metrics.length > 0).map(provider => `${provider.name} ${Math.round(Math.max(0, 100 - provider.metrics[0].usedPercent))}% left`).join(' · ');
    void invoke('set_tray_summary', { summary: `${settings.demo ? 'Demo · ' : ''}${limits.slice(0, 130) || 'Choose your providers in Settings'}` }).catch(() => {});
  }, [settings.demo, providers.map(provider => `${provider.id}:${provider.metrics[0]?.usedPercent}`).join(',')]);

  function updateSettings(update: Partial<Settings>) {
    const next = { ...settings, ...update };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); setSettings(next); }
    catch { setError('Your settings could not be saved on this device.'); }
  }
  async function openDashboard(page: 'dashboard' | 'settings' | 'connections' | 'activity' = 'dashboard') {
    setOptions(false);
    if (!isTauri()) { window.location.href = `/?page=${page}`; return; }
    try { await invoke('show_dashboard', { page }); } catch { setError('The requested window could not be opened.'); }
  }
  function refresh() { live.refresh(); setRefreshed(Date.now()); setNow(Date.now()); setOptions(false); }
  const failures = !settings.demo ? live.results.filter(result => (view === 'overview' || result.id === view) && (result.loading || result.error)) : [];
  let offset = 0;
  return <main className="quick-view" aria-label="MeterLuma usage panel">
    <nav className="quick-rail" aria-label="Panel navigation">
      <button className={view === 'overview' ? 'active' : ''} aria-label="Overview" aria-current={view === 'overview' ? 'page' : undefined} title="Overview" onClick={() => setView('overview')}><Mark size={25}/></button>
      <div className="quick-rail-providers">{navigationProviders.map(provider => <button key={provider.id} style={{ '--provider-color': colors[provider.id] } as CSSProperties} className={view === provider.id ? 'active' : ''} aria-label={`${provider.name} details`} aria-current={view === provider.id ? 'page' : undefined} title={provider.name} onClick={() => setView(provider.id)}><ProviderLogo id={provider.id}/></button>)}</div>
      <button className={view === 'costs' ? 'active' : ''} aria-label="Costs" aria-current={view === 'costs' ? 'page' : undefined} title="Costs" onClick={() => setView('costs')}><Icon name="activity" size={20} selected={view === 'costs'}/></button>
      <div className="quick-rail-bottom"><button className={view === 'help' ? 'active' : ''} aria-label="Help" aria-current={view === 'help' ? 'page' : undefined} title="Help" onClick={() => setView('help')}><Icon name="info" size={20} selected={view === 'help'}/></button><button className={view === 'settings' ? 'active' : ''} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} title="Settings" onClick={() => setView('settings')}><Icon name="settings" size={20} selected={view === 'settings'}/></button></div>
    </nav>
    <LicenseGate settings={settings} update={updateSettings}/>
    <div className="quick-body"><div className="quick-scroll" tabIndex={0} ref={scroll} aria-label="Panel content">
      <header className="quick-header"><div><h1>{view === 'overview' ? 'Overview' : view === 'costs' ? 'Cost' : view === 'settings' ? 'Settings' : view === 'help' ? 'About MeterLuma' : catalog.find(provider => provider.id === view)?.name}</h1><span className="quick-mode">{settings.demo ? 'Demo' : 'Live'}</span></div>{isProviderView && detail && <span className="quick-plan" title={detail.accountLabel}>{detail.cached ? 'Cached quotas' : detail.metrics.length ? detail.plan : detail.quotaState === 'rate_limited' ? 'Rate limited' : detail.quotaState === 'sign_in_required' ? 'Sign in' : 'Unavailable'}</span>}<button className="quick-refresh" aria-label="Refresh usage" disabled={live.loading} onClick={refresh}><Icon name="refresh" size={15}/></button></header>
      <UsageAlerts settings={settings} providers={providers} now={now}/>{view === 'overview' && <><div className="quick-providers">{providers.map(provider => <QuickProvider key={provider.connectionKey ?? provider.id} provider={provider} settings={settings} now={now}/>)}</div>{!providers.length && !live.loading && <div className="quick-empty"><p>Keep your allowances in view.</p><button onClick={() => void openDashboard('connections')}>Choose providers <Icon name="arrow" size={14}/></button></div>}{settings.demo && providers.length > 0 && <button className="quick-cost-summary" onClick={() => setView('costs')}><span>Sample spend today</span><strong>{money(providers.reduce((sum, provider) => sum + provider.spendToday!, 0))}</strong><Icon name="chevron" size={13}/></button>}</>}
      {isProviderView && details.length > 1 && <label className="quick-account-picker">Local account<select value={detail.connectionKey} onChange={event => setProfileKey(event.target.value)}>{details.map(provider => <option key={provider.connectionKey} value={provider.connectionKey}>{provider.accountLabel ?? 'Default profile'}</option>)}</select></label>}
      {isProviderView && (detail ? <QuickProvider provider={detail} settings={settings} now={now} detailed retry={refresh} connectionError={live.results.find(result => result.key === detail.connectionKey)?.error} reconnect={() => void openDashboard('connections')}/> : !live.loading && <div className="quick-empty"><p>This provider is not connected.</p><button onClick={() => void openDashboard('connections')}>Connection options <Icon name="arrow" size={14}/></button></div>)}
      {view === 'costs' && <><p className="quick-info">{settings.demo ? 'Simulated spending in USD. These are not your bills.' : 'Live allowances and recorded device activity are available. Dollar spending is unavailable.'}</p><section className="quick-cost" aria-label="Provider costs"><div className="quick-tabs" aria-label="Cost date range">{(['Today', 'Yesterday', '30 Days'] as const).map(value => <button key={value} aria-pressed={range === value} className={range === value ? 'selected' : ''} onClick={() => setRange(value)}>{value}</button>)}</div>{costs.length > 0 ? <div className="quick-cost-content"><div className="quick-donut" role="img" aria-label={`${range} simulated costs: ${money(total)}`}><svg viewBox="0 0 120 120" aria-hidden="true"><circle className="quick-donut-track" cx="60" cy="60" r="48"/>{costs.map(provider => {
        const fraction = total ? provider.cost / total * 100 : 0; const start = offset; offset += fraction;
        return <circle key={provider.id} cx="60" cy="60" r="48" pathLength="100" fill="none" stroke={colors[provider.id]} strokeWidth="12" strokeDasharray={`${Math.max(0, fraction - 1.7)} ${100 - Math.max(0, fraction - 1.7)}`} strokeDashoffset={-start} transform="rotate(-90 60 60)"/>;
      })}</svg><div><strong>{money(total)}</strong><span>USD · sample</span></div></div><ul className="quick-cost-legend">{costs.map(provider => <li key={provider.id}><i style={{ background: colors[provider.id] }}/><span>{provider.name}</span><strong>{money(provider.cost)}</strong></li>)}</ul></div> : <div className="quick-cost-empty"><Icon name="info" size={19}/><p>{settings.demo ? 'Enable a provider to preview costs.' : 'Cost data unavailable'}</p></div>}</section></>}
      {view === 'settings' && <QuickSettings settings={settings} update={updateSettings} catalog={catalog} connect={() => void openDashboard('connections')} activity={() => void openDashboard('activity')} alerts={() => void openDashboard('settings')}/>}
      {view === 'help' && <section className="quick-help"><Mark size={42}/><h2>All your AI usage,<br/>one glance.</h2><p>MeterLuma keeps your plan limits and reset times close while you work.</p><div><h3>Connect your accounts</h3><p>Claude and Cursor quotas use your existing local sign-ins. Codex uses its official CLI. These live connections are experimental.</p><button onClick={() => void openDashboard('connections')}>Manage connections <Icon name="arrow" size={14}/></button></div><p className="quick-info">Internal beta · v0.1.0. Live integrations are experimental. Free for personal, noncommercial use only. Selling and redistribution are prohibited.</p></section>}
      {failures.filter(result => !(isProviderView && detail && result.key === detail.connectionKey)).map(result => <p className="quick-info" role="status" key={result.key}>{result.loading ? `Fetching ${result.id}…` : result.error}</p>)}
      {error && <p role="status" className="quick-info">{error}</p>}
    </div><footer className="quick-footer"><div><span className="quick-status">{settings.demo ? 'Sample data only' : displayedFetchedAt ? `${detail?.cached ? 'Cached from' : 'Fetched'} ${new Date(displayedFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : detail?.quotaState === 'rate_limited' ? 'Usage rate limited' : 'Recorded activity / available quotas'}</span><small>MeterLuma 0.1.0 · {detail?.retryAt && detail.retryAt > now ? `Usage retry in ${retryCountdown(detail.retryAt, now)}` : nextRefresh !== null ? `Next update in ${nextRefresh}m` : 'Connect to refresh'}</small></div><button className="quick-options-button" ref={optionsButton} aria-haspopup="menu" aria-expanded={options} aria-controls="quick-options" onClick={() => setOptions(value => !value)}>Options <Icon name="chevron" size={12}/></button></footer></div>
    {options && <div id="quick-options" className="quick-options" role="menu" aria-label="Options" ref={optionsMenu} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOptions(false); optionsButton.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = Array.from(optionsMenu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []); const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}><button role="menuitem" onClick={refresh}><Icon name="refresh" size={15}/>Refresh now</button><button role="menuitem" onClick={() => void openDashboard('connections')}><Icon name="link" size={15}/>Connections</button><button role="menuitem" onClick={() => { setView('settings'); setOptions(false); }}><Icon name="settings" size={15}/>Settings</button><button role="menuitem" onClick={() => void openDashboard()}><Icon name="grid" size={15}/>Open dashboard</button>{isTauri() && <><hr/><button role="menuitem" onClick={() => void invoke('quit_app').catch(() => setError('MeterLuma could not quit.'))}><Icon name="quit" size={15}/>Quit MeterLuma</button></>}</div>}
  </main>;
}
