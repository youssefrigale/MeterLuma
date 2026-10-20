import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Icon, Mark } from './icons';
import { readSettings, resetPreferences, sampleProviders, dailySpend, money, SETTINGS_KEY, type Provider, type Settings, type ProviderId } from './model';
import { hasQuotas, useLiveProviders } from './useLiveProviders';
import { QuickSettings } from './QuickSettings';
import { QuickProvider, colors, thirtyDaySpend } from './QuickProvider';
import { ProviderLogo } from './ProviderLogo';
import { LegalMaterials, LicenseGate } from './LegalNotice';
import { Modal } from './Modal';
import { QuickConnections } from './QuickConnections';
import { UsageAlerts } from './Alerts';
import { retryCountdown } from './providerState';
import { APP_VERSION, CLAUDE_LOCAL, count, formatTime, providerNames, visibleMetrics } from './format';
import { estimatedValue } from './coverage';
import { NotAffiliated } from './ProviderNotes';

type View = 'overview' | 'costs' | 'connections' | 'settings' | 'help' | ProviderId;
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
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'license' | 'reset' | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsMenu = useRef<HTMLDivElement>(null);
  const live = useLiveProviders(settings);
  const catalog = sampleProviders(anchor);
  const providers = (settings.demo ? catalog.filter(provider => settings.enabled.includes(provider.id)) : live.results.flatMap(result => result.provider ? [result.provider] : [])).sort((a, b) => settings.providerOrder.indexOf(a.id) - settings.providerOrder.indexOf(b.id));
  const selectedProviders = new Set(settings.demo ? settings.enabled : [
    ...settings.liveProviders,
    ...settings.profiles.filter(profile => !profile.paused && !settings.tokenProviders?.includes(profile.providerId)).map(profile => profile.providerId),
  ]);
  const navigationProviders = settings.providerOrder.flatMap(id => settings.enabled.includes(id) && selectedProviders.has(id) ? catalog.filter(provider => provider.id === id) : []);
  const selectedViewAvailable = navigationProviders.some(provider => provider.id === view);
  const hasChosenProviders = navigationProviders.length > 0;
  // A connection that failed without any data still gets a details page with its state and a retry.
  const failed: Provider[] = settings.demo ? [] : live.results.filter(result => result.id === view && !result.provider && result.error && !result.loading).map(result => ({ id: result.id, name: providerNames[result.id], plan: '', color: colors[result.id], initials: '', spendToday: null, metrics: [], historyOnly: !hasQuotas(result.id), tokenOnly: result.key.startsWith('token-'), quotaState: hasQuotas(result.id) ? result.quotaFailure?.code ?? 'unavailable' : undefined, retryAt: result.quotaFailure?.retryAt, connectionKey: result.key, accountLabel: result.label }));
  const details = [...providers.filter(provider => provider.id === view), ...failed];
  const detail = details.find(provider => provider.connectionKey === profileKey) ?? details[0];
  const isProviderView = ['claude', 'codex', 'cursor'].includes(view);
  const displayedFetchedAt = isProviderView ? detail?.fetchedAt : live.updatedAt;
  const costs = settings.demo
    ? providers.map(provider => ({ ...provider, key: provider.id, cost: range === 'Today' ? provider.spendToday! : range === 'Yesterday' ? dailySpend[provider.id].at(-2)! : thirtyDaySpend(provider.id), unpriced: 0, label: '' }))
    : providers.flatMap(provider => { const value = estimatedValue(provider.history, range); return value ? [{ ...provider, key: provider.connectionKey ?? provider.id, ...value, name: `${provider.name}${provider.accountLabel ? ` · ${provider.accountLabel}` : ''}` }] : []; });
  const total = costs.reduce((sum, provider) => sum + provider.cost, 0);
  const unpriced = costs.reduce((sum, provider) => sum + provider.unpriced, 0);
  const since = costs.find(provider => provider.label.startsWith('Since'))?.label;
  const interval = Math.max(5, settings.refreshMinutes) * 60_000;
  const nextRefresh = settings.demo ? Math.max(1, Math.ceil((interval - (now - refreshed) % interval) / 60_000)) : live.nextRefreshAt ? Math.max(1, Math.ceil((live.nextRefreshAt - now) / 60_000)) : Math.max(5, settings.refreshMinutes);
  const updateStatus = settings.demo ? 'Sample data only' : isProviderView && detail?.historyOnly ? detail.history ? `Scanned ${formatTime(detail.history.scannedAt, settings.timeFormat)}` : 'Recorded local history' : displayedFetchedAt ? `${isProviderView ? detail?.cached ? 'Cached from' : 'Fetched' : 'Updated'} ${formatTime(displayedFetchedAt, settings.timeFormat)}` : detail?.quotaState === 'rate_limited' ? 'Usage rate limited' : 'Connect to refresh';
  const updateHint = `${updateStatus}${detail?.retryAt && detail.retryAt > now ? `. Usage retry in ${retryCountdown(detail.retryAt, now)}` : ''}`;
  const trayLimits = providers.flatMap(provider => { const metric = visibleMetrics(provider, now)[0]; return metric ? [`${provider.name} ${Math.round(Math.max(0, 100 - metric.usedPercent))}% left${provider.cached ? ' (cached)' : ''}`] : []; }).join(' · ');
  const traySummary = `${settings.demo ? 'Demo · ' : ''}${trayLimits.slice(0, 130) || (providers.length ? 'Recorded local history' : live.loading ? 'Reading usage…' : 'Choose your providers in Settings')}`;

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
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== 'hidden') setNow(Date.now()); };
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => { if (isProviderView && !selectedViewAvailable) setView('overview'); }, [selectedViewAvailable, isProviderView]);
  useEffect(() => { if (view === 'costs' && !hasChosenProviders) setView('overview'); }, [view, hasChosenProviders]);
  // The panel is never reloaded, so messages are cleared on navigation and after a short time.
  useEffect(() => { scroll.current?.scrollTo(0, 0); setOptions(false); setMessage(''); }, [view]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 8000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    if (!isTauri()) return;
    const height = view === 'costs' ? 480 : view === 'help' ? 560 : 660;
    void invoke('resize_quick', { height }).catch(() => setMessage('The panel could not be resized.'));
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
    void invoke('set_tray_summary', { summary: traySummary }).catch(() => {});
  }, [traySummary]);

  function updateSettings(update: Partial<Settings>) {
    const next = { ...settings, ...update };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); setSettings(next); setMessage(''); return true; }
    catch { setMessage('Your settings could not be saved on this device.'); return false; }
  }
  function show(next: View) { setView(next); setOptions(false); }
  function resetDisplay() {
    setDialog(null);
    if (updateSettings(resetPreferences(settings))) setMessage('Preferences reset. Connections, alerts and consent were kept.');
  }
  function refresh() { live.refresh(); setRefreshed(Date.now()); setNow(Date.now()); setOptions(false); setMessage(''); }
  const failures = !settings.demo ? live.results.filter(result => (view === 'overview' || result.id === view) && ((result.loading && !result.provider) || result.error)) : [];
  let offset = 0;
  return <main className="quick-view" aria-label="MeterLuma usage panel">
    <nav className="quick-rail" aria-label="Panel navigation">
      <button className={view === 'overview' ? 'active' : ''} aria-label="Overview" aria-current={view === 'overview' ? 'page' : undefined} title="Overview" onClick={() => setView('overview')}><Mark size={25}/></button>
      <div className="quick-rail-providers">{navigationProviders.map(provider => <button key={provider.id} className={view === provider.id ? 'active' : ''} aria-label={`${provider.name} details`} aria-current={view === provider.id ? 'page' : undefined} title={provider.name} onClick={() => setView(provider.id)}><ProviderLogo id={provider.id} size={22}/></button>)}</div>
      {hasChosenProviders && <button className={view === 'costs' ? 'active' : ''} aria-label="Costs" aria-current={view === 'costs' ? 'page' : undefined} title="Costs" onClick={() => setView('costs')}><Icon name="activity" size={20} selected={view === 'costs'}/></button>}
      <div className="quick-rail-bottom"><button className={view === 'connections' ? 'active' : ''} aria-label="Connections" aria-current={view === 'connections' ? 'page' : undefined} title="Connections" onClick={() => setView('connections')}><Icon name="link" size={20} selected={view === 'connections'}/></button><button className={view === 'help' ? 'active' : ''} aria-label="Help" aria-current={view === 'help' ? 'page' : undefined} title="Help" onClick={() => setView('help')}><Icon name="info" size={20} selected={view === 'help'}/></button><button className={view === 'settings' ? 'active' : ''} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} title="Settings" onClick={() => setView('settings')}><Icon name="settings" size={20} selected={view === 'settings'}/></button></div>
    </nav>
    <LicenseGate settings={settings} update={updateSettings}/>
    <div className="quick-body"><div className="quick-scroll" tabIndex={0} ref={scroll} aria-label="Panel content">
      <header className="quick-header"><div><h1>{view === 'overview' ? 'Overview' : view === 'costs' ? 'Cost' : view === 'connections' ? 'Connections' : view === 'settings' ? 'Settings' : view === 'help' ? 'About MeterLuma' : providerNames[view]}</h1><span className="quick-mode">{settings.demo ? 'Demo' : 'Live'}</span></div>{isProviderView && detail && <span className="quick-plan" title={detail.accountLabel}>{detail.historyOnly ? 'Local history' : detail.cached ? 'Cached quotas' : visibleMetrics(detail, now).length ? detail.plan : detail.quotaState === 'rate_limited' ? 'Rate limited' : detail.quotaState === 'sign_in_required' ? 'Sign in' : 'Unavailable'}</span>}<button className="quick-refresh" aria-label="Refresh usage" disabled={live.loading} onClick={refresh}><Icon name="refresh" size={15}/></button></header>
      <UsageAlerts settings={settings} providers={providers} now={now}/>{view === 'overview' && <><div className="quick-providers">{providers.map(provider => <QuickProvider key={provider.connectionKey ?? provider.id} provider={provider} settings={settings} now={now}/>)}</div>{!providers.length && !live.loading && <div className="quick-empty"><p>Keep your allowances in view.</p><button onClick={() => setView('connections')}>Choose providers <Icon name="arrow" size={14}/></button></div>}{settings.demo && providers.length > 0 && <button className="quick-cost-summary" onClick={() => setView('costs')}><span>Sample spend today</span><strong>{money(providers.reduce((sum, provider) => sum + provider.spendToday!, 0))}</strong><Icon name="chevron" size={13}/></button>}</>}
      {isProviderView && details.length > 1 && <label className="quick-account-picker">Local account<select value={detail.connectionKey} onChange={event => setProfileKey(event.target.value)}>{details.map(provider => <option key={provider.connectionKey} value={provider.connectionKey}>{provider.accountLabel ?? 'Default profile'}</option>)}</select></label>}
      {isProviderView && (detail ? <QuickProvider provider={detail} settings={settings} now={now} detailed retry={refresh} connectionError={live.results.find(result => result.key === detail.connectionKey)?.error} reconnect={() => setView('connections')}/> : !live.loading && <div className="quick-empty"><p>This provider is not connected.</p><button onClick={() => setView('connections')}>Connection options <Icon name="arrow" size={14}/></button></div>)}
      {view === 'costs' && <><p className="quick-info">{settings.demo ? 'Simulated spending in USD. These are not your bills.' : 'Estimated API value in USD: recorded local tokens at standard API rates. Not a bill or subscription charge.'}</p><section className="quick-cost" aria-label="Provider costs"><div className="quick-tabs" aria-label="Cost date range">{(['Today', 'Yesterday', '30 Days'] as const).map(value => <button key={value} aria-pressed={range === value} className={range === value ? 'selected' : ''} onClick={() => setRange(value)}>{value}</button>)}</div>{costs.length > 0 ? <div className="quick-cost-content"><div className="quick-donut" role="img" aria-label={settings.demo ? `${range} simulated costs: ${money(total)}` : `${range} estimated API value: ${money(total)}`}><svg viewBox="0 0 120 120" aria-hidden="true"><circle className="quick-donut-track" cx="60" cy="60" r="48"/>{costs.map(provider => {
        const fraction = total ? provider.cost / total * 100 : 0; const start = offset; offset += fraction;
        return <circle key={provider.key} cx="60" cy="60" r="48" pathLength="100" fill="none" stroke={colors[provider.id]} strokeWidth="12" strokeDasharray={`${Math.max(0, fraction - 1.7)} ${100 - Math.max(0, fraction - 1.7)}`} strokeDashoffset={-start} transform="rotate(-90 60 60)"/>;
      })}</svg><div><strong>{settings.demo ? '' : '~'}{money(total)}</strong><span>{settings.demo ? 'USD · sample' : 'USD · estimate'}</span></div></div><ul className="quick-cost-legend">{costs.map(provider => <li key={provider.key}><i style={{ background: colors[provider.id] }}/><span>{provider.name}</span><strong>{money(provider.cost)}</strong></li>)}</ul></div> : <div className="quick-cost-empty"><Icon name="info" size={19}/><p>{settings.demo ? 'Enable a provider to preview costs.' : <><span>No estimated API value yet</span><small>Dollar estimates need recorded Claude Code history with known model prices.</small></>}</p></div>}</section>{!settings.demo && costs.length > 0 && (since || unpriced > 0) && <p className="quick-info quick-cost-notes">{range === '30 Days' && since ? `${since}: earlier days have no local logs. ` : ''}{unpriced > 0 ? `Excludes ${count(unpriced)} tokens from models without a known price.` : ''}</p>}</>}
      {view === 'connections' && <QuickConnections settings={settings} update={updateSettings} results={live.results} onTokenChange={live.tokenChanged}/>}
      {view === 'settings' && <QuickSettings settings={settings} update={updateSettings} catalog={catalog} providers={providers} connect={() => setView('connections')}/>}
      {view === 'help' && <section className="quick-help"><Mark size={42}/><h2>All your AI usage,<br/>one glance.</h2><p>MeterLuma keeps your plan limits, reset times and recorded token history close while you work.</p><div><h3>Connect your accounts</h3><p>Codex quotas come from its official CLI. Cursor's monthly allowance uses your local Cursor sign-in with an unofficial endpoint. Claude shows recorded token history only. {CLAUDE_LOCAL}</p><button onClick={() => setView('connections')}>Manage connections <Icon name="arrow" size={14}/></button></div><NotAffiliated className="quick-info"/><p className="quick-info">MeterLuma v{APP_VERSION}{import.meta.env.DEV ? ' · development build' : ''}. Free for personal, noncommercial use only. Selling and redistribution are prohibited.</p><div className="quick-help-actions"><button onClick={() => setDialog('license')}>View license</button><button onClick={() => setDialog('reset')}>Reset preferences</button></div></section>}
      {failures.filter(result => !(isProviderView && detail && result.key === detail.connectionKey)).map(result => <p className="quick-info" role="status" key={result.key}>{result.loading && !result.provider ? `Reading ${providerNames[result.id]}${result.label ? ` · ${result.label}` : ''}…` : `${providerNames[result.id]}${result.label ? ` · ${result.label}` : ''}: ${result.error}`}</p>)}
      {message && <p role="status" className="quick-info">{message}</p>}
    </div><footer className="quick-footer"><button className="quick-version" aria-label="Options" title="MeterLuma options" ref={optionsButton} aria-haspopup="menu" aria-expanded={options} aria-controls="quick-options" onClick={() => setOptions(value => !value)}>MeterLuma {APP_VERSION}<Icon name="chevron" size={11}/></button><span className="quick-update" title={updateHint}>Next update in {nextRefresh}m</span></footer></div>
    {options && <div id="quick-options" className="quick-options" role="menu" aria-label="Options" ref={optionsMenu} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOptions(false); optionsButton.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = Array.from(optionsMenu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []); const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}><button role="menuitem" onClick={refresh}><Icon name="refresh" size={15}/>Refresh now</button><button role="menuitem" onClick={() => show('connections')}><Icon name="link" size={15}/>Connections</button><button role="menuitem" onClick={() => show('settings')}><Icon name="settings" size={15}/>Settings</button>{isTauri() && <><hr/><button role="menuitem" onClick={() => void invoke('quit_app').catch(() => setMessage('MeterLuma could not quit.'))}><Icon name="quit" size={15}/>Quit MeterLuma</button></>}</div>}
    {dialog === 'license' && <Modal title="Free for personal use." onClose={() => setDialog(null)}><p className="modal-intro">Personal, noncommercial use only. Selling and redistribution are prohibited. Third-party components retain their own licenses.</p><LegalMaterials/><button className="button primary full-width" onClick={() => setDialog(null)}>Done</button></Modal>}
    {dialog === 'reset' && <Modal title="Reset preferences?" onClose={() => setDialog(null)}><p className="modal-intro">Theme, display, time format, refresh interval, provider order and history window return to their defaults. Your connections, local accounts, usage alerts and license acceptance are kept.</p><div className="legal-buttons dialog-actions"><button className="button primary" onClick={resetDisplay}>Reset preferences</button><button className="button" onClick={() => setDialog(null)}>Cancel</button></div></Modal>}
  </main>;
}
