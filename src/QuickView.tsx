import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Icon, Mark } from './icons';
import { readSettings, resetPreferences, sampleProviders, dailySpend, money, SETTINGS_KEY, type Provider, type Settings, type ProviderId } from './model';
import { hasQuotas, useLiveProviders } from './useLiveProviders';
import { useLocalDiscovery } from './useLocalDiscovery';
import { QuickSettings } from './QuickSettings';
import { QuickProvider, colors, thirtyDaySpend } from './QuickProvider';
import { ProviderLogo } from './ProviderLogo';
import { LegalMaterials, LicenseGate } from './LegalNotice';
import { Modal } from './Modal';
import { QuickConnections } from './QuickConnections';
import { UsageAlerts } from './Alerts';
import { retryCountdown } from './providerState';
import { APP_VERSION, LOW_ALLOWANCE_REMAINING, count, formatTime, planLabel, providerNames, visibleMetrics } from './format';
import { costRow } from './costRows';
import { NotAffiliated } from './ProviderNotes';
import { usePanelHeight } from './usePanelHeight';
import { orderedAdditional } from './providerOrder';
import { useAdditionalProviders } from './additional/useAdditionalProviders';
import { additionalConnections, additionalProvider } from './additional/model';
import { AdditionalProvider, amountText } from './additional/AdditionalProvider';
import { AdditionalLogo } from './additional/AdditionalLogo';
import { AdditionalConnections } from './additional/AdditionalConnections';
import { selectTrayMetric } from './pacing';
import { DiagnosticTools } from './DiagnosticTools';
import { usePanelShortcut } from './usePanelShortcut';
import { useUsageNotifications } from './useUsageNotifications';
import { toggleExpandedCard } from './collapsedCards';
import { trayWarningReasons } from './trayWarnings';

type View = 'overview' | 'costs' | 'connections' | 'settings' | 'help' | ProviderId | `additional:${string}`;
type Range = 'Today' | 'Yesterday' | '30 Days';

function primaryTrayMetric(provider: Provider, now: number, selection: Settings['trayMetric']) {
  const metrics = visibleMetrics(provider, now);
  return selectTrayMetric(metrics,selection);
}

export default function QuickView() {
  const [settings, setSettings] = useState(readSettings);
  const shortcut = usePanelShortcut(settings.panelShortcut, panelShortcut => updateSettings({ panelShortcut }));
  const [anchor] = useState(Date.now);
  const [, setClockTime] = useState(Date.now);
  // Background lookups can render after the hidden panel has stopped its display timer.
  const now = Date.now();
  const [refreshed, setRefreshed] = useState(Date.now);
  const [view, setView] = useState<View>('overview');
  const [profileKey, setProfileKey] = useState('');
  const [range, setRange] = useState<Range>('Today');
  const [options, setOptions] = useState(false);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'license' | 'reset' | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsMenu = useRef<HTMLDivElement>(null);
  const live = useLiveProviders(settings);
  const additionalReadings = useAdditionalProviders(settings);
  const additional = { ...additionalReadings, results: orderedAdditional(additionalReadings.results, settings.additionalProviderOrder) };
  const additionalNavigation = settings.demo ? [] : orderedAdditional(additionalConnections(settings.additionalConnections), settings.additionalProviderOrder).filter(connection => connection.enabled !== false && additionalProvider(connection.id)?.state === 'ready');
  const additionalId = view.startsWith('additional:') ? view.slice(11) : undefined;
  const additionalSpec = additionalId ? additionalProvider(additionalId) : undefined;
  const additionalActive = additional.results.find(result => result.id === additionalId);
  const discovery = useLocalDiscovery(settings, updateSettings);
  const catalog = sampleProviders(anchor);
  const providers = (settings.demo ? catalog.filter(provider => settings.enabled.includes(provider.id)) : live.results.flatMap(result => result.provider ? [result.provider] : [])).sort((a, b) => settings.providerOrder.indexOf(a.id) - settings.providerOrder.indexOf(b.id));
  const notifications = useUsageNotifications({ settings, providers, additional: additional.results, remember: notifications => updateSettings({ notifications }) });
  const selectedProviders = new Set(settings.demo ? settings.enabled : [
    ...settings.liveProviders,
    ...settings.profiles.filter(profile => !profile.paused && !settings.tokenProviders?.includes(profile.providerId)).map(profile => profile.providerId),
  ]);
  const navigationProviders = settings.providerOrder.flatMap(id => settings.enabled.includes(id) && selectedProviders.has(id) ? catalog.filter(provider => provider.id === id) : []);
  const selectedViewAvailable = navigationProviders.some(provider => provider.id === view);
  const hasChosenProviders = navigationProviders.length > 0 || additionalNavigation.length > 0;
  // A connection that failed without any data still gets a details page with its state and a retry.
  const failed: Provider[] = settings.demo ? [] : live.results.filter(result => result.id === view && !result.provider && result.error && !result.loading).map(result => ({ id: result.id, name: providerNames[result.id], plan: '', color: colors[result.id], initials: '', spendToday: null, metrics: [], historyOnly: !hasQuotas(result.id, settings), tokenOnly: result.key.startsWith('token-'), quotaState: hasQuotas(result.id, settings) ? result.quotaFailure?.code ?? 'unavailable' : undefined, retryAt: result.quotaFailure?.retryAt, connectionKey: result.key, accountLabel: result.label }));
  const details = [...providers.filter(provider => provider.id === view), ...failed];
  const detail = details.find(provider => provider.connectionKey === profileKey) ?? details[0];
  const isProviderView = ['claude', 'codex', 'cursor'].includes(view);
  const displayedFetchedAt = isProviderView ? detail?.fetchedAt : live.updatedAt;
  const costs = settings.demo
    ? providers.map(provider => ({ ...provider, key: provider.id, cost: range === 'Today' ? provider.spendToday! : range === 'Yesterday' ? dailySpend[provider.id].at(-2)! : thirtyDaySpend(provider.id), unpriced: 0, label: '', status: '', note: undefined }))
    : live.results.map(connection => costRow(connection, range));
  const pricedCosts = costs.filter(provider => provider.cost !== null);
  const total = pricedCosts.reduce((sum, provider) => sum + provider.cost!, 0);
  const unpriced = pricedCosts.reduce((sum, provider) => sum + provider.unpriced, 0);
  const since = pricedCosts.find(provider => provider.label.startsWith('Since'))?.label;
  const interval = Math.max(5, settings.refreshMinutes) * 60_000;
  const nextRefreshAt = Math.min(...[live.nextRefreshAt, additional.nextRefreshAt].filter((time): time is number => time !== null));
  const nextRefresh = settings.demo ? Math.max(1, Math.ceil((interval - (now - refreshed) % interval) / 60_000)) : Number.isFinite(nextRefreshAt) ? Math.max(1, Math.ceil((nextRefreshAt - now) / 60_000)) : Math.max(5, settings.refreshMinutes);
  const updateStatus = settings.demo ? 'Sample data only' : isProviderView && detail?.historyOnly ? detail.history ? `Scanned ${formatTime(detail.history.scannedAt, settings.timeFormat)}` : 'Recorded local history' : displayedFetchedAt ? `${isProviderView ? detail?.cached ? 'Cached from' : 'Fetched' : 'Updated'} ${formatTime(displayedFetchedAt, settings.timeFormat)}` : detail?.quotaState === 'rate_limited' ? 'Usage rate limited' : 'Connect to refresh';
  const updateHint = `${updateStatus}${detail?.retryAt && detail.retryAt > now ? `. Usage retry in ${retryCountdown(detail.retryAt, now)}` : ''}`;
  const trayLimits = providers.flatMap(provider => { const metric = primaryTrayMetric(provider, now, settings.trayMetric); return metric ? [`${provider.name} ${metric.label} ${Math.round(Math.max(0, 100 - metric.usedPercent))}% left${provider.cached ? ' (cached)' : ''}`] : []; }).join(' · ');
  const traySummary = `${settings.demo ? 'Demo · ' : ''}${trayLimits.slice(0, 130) || (providers.length ? 'Recorded local history' : live.loading ? 'Reading usage…' : 'Choose your providers in Settings')}`;
  const trayProvider = [detail, ...providers].find(provider => provider && !provider.historyOnly && visibleMetrics(provider, now).length > 0);
  const trayMetric = trayProvider && primaryTrayMetric(trayProvider, now, settings.trayMetric);
  const trayRemaining = trayMetric && Math.round(Math.min(100, Math.max(0, 100 - trayMetric.usedPercent)));
  const additionalTray = additionalActive?.snapshot ?? (!trayProvider ? additional.results.find(result => result.snapshot)?.snapshot : undefined);
  const additionalTrayMetric = additionalTray && selectTrayMetric(additionalTray.metrics.filter(metric => !additionalTray.cached || (metric.resetAt === null ? now - additionalTray.fetchedAt <= 300_000 : metric.resetAt > now)), settings.trayMetric);
  const additionalTrayValue = !additionalTrayMetric && additionalTray?.amounts[0] ? amountText(additionalTray.amounts[0]) : undefined;
  const displayedTrayMetric = additionalTray && (additionalTrayMetric || additionalTrayValue) ? additionalTrayMetric : trayMetric;
  const usageSummary = additionalTray ? `${additionalTray.name} · ${additionalTrayMetric ? `${additionalTrayMetric.label} ${Math.round(Math.max(0, 100 - additionalTrayMetric.usedPercent))}% left` : additionalTray.amounts[0] ? `${additionalTray.amounts[0].label}: ${additionalTrayValue}` : 'Usage unavailable'}${additionalTray.cached ? ' (cached)' : ''}`.slice(0, 150) : traySummary;
  const trayWarnings = settings.demo ? [] : trayWarningReasons(live.results, additional.results, trayProvider, { now, interval });
  const trayWarning = !settings.demo && displayedTrayMetric !== undefined && 100 - displayedTrayMetric.usedPercent <= LOW_ALLOWANCE_REMAINING;
  const menuSummary = (trayWarnings.length ? `${trayWarnings.join('; ')} · ${usageSummary}` : usageSummary).slice(0, 160);
  const pageNames: Record<string, string> = { overview: 'Overview', costs: 'Cost', connections: 'Connections', settings: 'Settings', help: 'About MeterLuma', ...providerNames };
  const pageName = additionalSpec?.name ?? pageNames[view] ?? 'MeterLuma';

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
    let timer: number | undefined;
    const tick = () => { if (document.visibilityState !== 'hidden') setClockTime(Date.now()); };
    const visibility = () => {
      window.clearInterval(timer); timer = undefined;
      if (document.visibilityState !== 'hidden') { tick(); timer = window.setInterval(tick, 30_000); }
    };
    visibility();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (isProviderView && !selectedViewAvailable) setView('overview'); }, [selectedViewAvailable, isProviderView]);
  useEffect(() => { if (additionalId && !additionalNavigation.some(connection => connection.id === additionalId)) setView('overview'); }, [additionalId, JSON.stringify(additionalNavigation)]);
  useEffect(() => { if (view === 'costs' && !hasChosenProviders) setView('overview'); }, [view, hasChosenProviders]);
  // The panel is never reloaded, so messages are cleared on navigation and after a short time.
  useEffect(() => { scroll.current?.scrollTo(0, 0); setOptions(false); setMessage(''); }, [view]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 8000); return () => clearTimeout(timer); }, [message]);
  usePanelHeight(panel, setMessage);
  useEffect(() => {
    if (!options) return;
    optionsMenu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!optionsMenu.current?.contains(event.target as Node) && !optionsButton.current?.contains(event.target as Node)) setOptions(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [options]);
  useEffect(() => {
    if (!isTauri()) return;
    const status = additionalTray && (additionalTrayMetric || additionalTrayValue) ? { provider: additionalTray.id, ...(additionalTrayMetric ? { remaining: Math.round(Math.min(100, Math.max(0, 100 - additionalTrayMetric.usedPercent))) } : { value: additionalTrayValue }), cached: additionalTray.cached, demo: false, warning: trayWarning }
      : trayProvider && trayRemaining !== undefined ? { provider: trayProvider.id, remaining: trayRemaining, cached: !!trayProvider.cached, demo: settings.demo, warning: trayWarning } : null;
    void invoke('set_tray_summary', { summary: menuSummary, status }).catch(() => setMessage('The menu-bar usage could not be updated.'));
  }, [menuSummary, trayProvider?.id, trayRemaining, trayProvider?.cached, additionalTray?.id, additionalTray?.cached, additionalTrayMetric?.usedPercent, additionalTrayValue, trayWarning, settings.demo]);

  function updateSettings(update: Partial<Settings>) {
    const next = { ...settings, ...update };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); setSettings(next); setMessage(''); return true; }
    catch { setMessage('Your settings could not be saved on this device.'); return false; }
  }
  function cardFold(key: string) {
    return { collapsed: !settings.expandedCards?.includes(key), toggle: () => updateSettings({ expandedCards: toggleExpandedCard(settings.expandedCards ?? [], key) }) };
  }
  function show(next: View) { setView(next); setOptions(false); }
  function resetDisplay() {
    setDialog(null);
    if (updateSettings(resetPreferences(settings))) setMessage('Preferences reset. Connections, alerts and consent were kept.');
  }
  function refresh() { discovery.refresh(); live.refresh(); additional.refresh(); setRefreshed(Date.now()); setClockTime(Date.now()); setOptions(false); setMessage(''); }
  const failures = !settings.demo ? live.results.filter(result => (view === 'overview' || result.id === view) && ((result.loading && !result.provider) || result.error)) : [];
  return <main className="quick-view" aria-label="MeterLuma usage panel" ref={panel}>
    <nav className="quick-rail" aria-label="Panel navigation">
      <button className={view === 'overview' ? 'active' : ''} aria-label="Overview" aria-current={view === 'overview' ? 'page' : undefined} title="Overview" onClick={() => setView('overview')}><Mark size={25}/></button>
      <div className="quick-rail-providers">{navigationProviders.map(provider => <button key={provider.id} className={view === provider.id ? 'active' : ''} aria-label={`${provider.name} details`} aria-current={view === provider.id ? 'page' : undefined} title={provider.name} onClick={() => setView(provider.id)}><ProviderLogo id={provider.id} size={22}/></button>)}{additionalNavigation.map(connection => <button key={connection.id} className={additionalId === connection.id ? "active" : ""} aria-label={`${additionalProvider(connection.id)!.name} details`} aria-current={additionalId === connection.id ? "page" : undefined} title={connection.label} onClick={() => setView(`additional:${connection.id}`)}><AdditionalLogo id={connection.id}/></button>)}</div>
      {hasChosenProviders && <button className={view === 'costs' ? 'active' : ''} aria-label="Costs" aria-current={view === 'costs' ? 'page' : undefined} title="Costs" onClick={() => setView('costs')}><Icon name="activity" size={20} selected={view === 'costs'}/></button>}
      <div className="quick-rail-bottom"><button className={view === 'connections' ? 'active' : ''} aria-label="Connections" aria-current={view === 'connections' ? 'page' : undefined} title="Connections" onClick={() => setView('connections')}><Icon name="link" size={20} selected={view === 'connections'}/></button><button className={view === 'help' ? 'active' : ''} aria-label="Help" aria-current={view === 'help' ? 'page' : undefined} title="Help" onClick={() => setView('help')}><Icon name="info" size={20} selected={view === 'help'}/></button><button className={view === 'settings' ? 'active' : ''} aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} title="Settings" onClick={() => setView('settings')}><Icon name="settings" size={20} selected={view === 'settings'}/></button></div>
    </nav>
    <LicenseGate settings={settings} update={updateSettings}/>
    <div className="quick-body"><div className="quick-scroll" tabIndex={0} ref={scroll} aria-label="Panel content"><div className="quick-content">
      <header className="quick-header"><div><h1>{pageName}</h1>{settings.demo && <span className="quick-mode">Demo</span>}</div>{isProviderView && detail && <span className="quick-plan" title={detail.accountLabel}>{detail.historyOnly ? 'Local history' : detail.cached ? 'Cached quotas' : visibleMetrics(detail, now).length ? planLabel(detail) : detail.quotaState === 'rate_limited' ? 'Rate limited' : detail.quotaState === 'sign_in_required' ? 'Sign in' : 'Unavailable'}</span>}{additionalSpec && additionalActive?.snapshot?.plan && <span className="quick-plan">{additionalActive.snapshot.plan}</span>}<button className="quick-refresh" aria-label="Refresh usage" disabled={live.loading || additional.loading} onClick={refresh}><Icon name="refresh" size={15}/></button></header>
      <UsageAlerts settings={settings} providers={providers} now={now}/>{view === 'overview' && <><div className={`quick-providers${settings.compactOverview ? " is-compact" : ""}`}>{providers.map(provider => <QuickProvider key={provider.connectionKey ?? provider.id} provider={provider} settings={settings} now={now} fold={cardFold(`core:${provider.id}:${provider.connectionKey ?? provider.id}`)}/>)}{additional.results.map(result => <AdditionalProvider key={result.id} result={result} settings={settings} now={now} retry={additional.refresh} fold={cardFold(`additional:${result.id}`)}/>)}</div>{!providers.length && !additionalNavigation.length && !live.loading && <div className="quick-empty"><p>Keep your allowances in view.</p><button onClick={() => setView('connections')}>Choose providers <Icon name="arrow" size={14}/></button></div>}{settings.demo && providers.length > 0 && <button className="quick-cost-summary" onClick={() => setView('costs')}><span>Sample spend today</span><strong>{money(providers.reduce((sum, provider) => sum + provider.spendToday!, 0))}</strong><Icon name="chevron" size={13}/></button>}</>}
      {isProviderView && details.length > 1 && <label className="quick-account-picker">Local account<select value={detail.connectionKey} onChange={event => setProfileKey(event.target.value)}>{details.map(provider => <option key={provider.connectionKey} value={provider.connectionKey}>{provider.accountLabel ?? 'Default profile'}</option>)}</select></label>}
      {isProviderView && (detail ? <QuickProvider provider={detail} settings={settings} now={now} detailed retry={refresh} connectionError={live.results.find(result => result.key === detail.connectionKey)?.error} reconnect={() => setView('connections')}/> : !live.loading && <div className="quick-empty"><p>This provider is not connected.</p><button onClick={() => setView('connections')}>Connection options <Icon name="arrow" size={14}/></button></div>)}
      {additionalSpec && <AdditionalProvider result={additionalActive ?? { id: additionalSpec.id, label: additionalNavigation.find(connection => connection.id === additionalSpec.id)?.label ?? additionalSpec.name, loading: true }} settings={settings} now={now} detailed retry={additional.refresh}/>}
      {view === 'costs' && <>
        <section className="quick-cost" aria-label="Provider costs">
          <div className="quick-tabs" aria-label="Cost date range">{(['Today', 'Yesterday', '30 Days'] as const).map(value => <button key={value} aria-pressed={range === value} className={range === value ? 'selected' : ''} onClick={() => setRange(value)}>{value}</button>)}</div>
          {pricedCosts.length > 0 ?
            <div className="quick-cost-total" role="group" aria-label={settings.demo ? `${range} simulated costs: ${money(total)}` : `${range} estimated API value: ${money(total)}`}>
              <div className="quick-cost-label"><span>{settings.demo ? 'Sample spending' : 'Estimated API value'}</span><span>USD</span></div>
              <strong className="quick-cost-amount">{money(total)}</strong>
              <p>{costs.length > pricedCosts.length ? 'Total includes priced providers only.' : total === 0 ? 'No priced usage in this period.' : settings.demo ? 'Illustrative sample data' : 'From recorded token usage'}</p>
            </div>
            : <div className="quick-cost-empty"><Icon name="info" size={19}/><p>{settings.demo ? 'Enable a provider to preview costs.' : <><span>No estimated API value yet</span><small>API estimates need recorded token usage with known model prices.</small></>}</p></div>}
          {costs.length > 0 && <div className="quick-cost-breakdown"><h2>By provider</h2><ul className="quick-cost-legend">{costs.map(provider => <li key={provider.key}>
              <ProviderLogo id={provider.id} size={20}/><span className="quick-cost-provider"><span title={provider.name}>{provider.name}</span>{provider.note && <small>{provider.note}</small>}</span><strong>{provider.cost === null ? provider.status : money(provider.cost)}</strong>
            </li>)}</ul></div>
          }
        </section>
        <p className="quick-info quick-cost-disclaimer">{settings.demo ? 'Simulated spending in USD. These are not your bills.' : 'Recorded tokens at standard API rates. Not a bill or subscription charge.'}</p>
        {!!additionalNavigation.length && <p className="quick-info">Additional providers’ reported balances and spending appear in their provider details and are excluded from this local token-value estimate.</p>}
        {!settings.demo && pricedCosts.length > 0 && (since || unpriced > 0) && <p className="quick-info quick-cost-notes">{range === '30 Days' && since ? `${since}: earlier days have no local logs. ` : ''}{unpriced > 0 ? `Excludes ${count(unpriced)} tokens from models without a known price.` : ''}</p>}
      </>}
      {view === 'connections' && <>{discovery.checking && <p className="quick-info" role="status">Checking local connections...</p>}{discovery.error && <p className="quick-info" role="status">{discovery.error}</p>}<QuickConnections settings={settings} update={updateSettings} results={live.results} onTokenChange={live.tokenChanged}/><AdditionalConnections settings={settings} update={updateSettings} results={additional.results} refresh={additional.refresh}/></>}
      {view === 'settings' && <QuickSettings notifications={notifications} shortcut={shortcut} settings={settings} update={updateSettings} catalog={catalog} providers={providers} connect={() => setView('connections')}/>}
      {view === 'help' && <section className="quick-help"><div className="quick-help-intro"><Mark size={38}/><h2>All your AI usage,<br/>one glance.</h2></div><p className="quick-help-lede">MeterLuma keeps your plan limits, reset times and recorded token history close while you work.</p><div className="quick-help-section"><h3>Connect your accounts</h3><p>Codex quotas come from its official CLI. Cursor's monthly allowance uses your local Cursor sign-in with an unofficial endpoint. Claude shows recorded token history, with optional session and weekly limits after you enable live Claude usage in Connections.</p><button className="quick-help-link" onClick={() => setView('connections')}>Manage connections <Icon name="arrow" size={14}/></button></div><DiagnosticTools settings={settings} core={live.results} additional={additional.results}/><div className="quick-help-section quick-help-legal"><p>MeterLuma v{APP_VERSION}{import.meta.env.DEV ? ' · development build' : ''}. Free for personal, noncommercial use only. Selling and redistribution are prohibited.</p><NotAffiliated/><div className="quick-help-actions"><button className="quick-help-link" onClick={() => setDialog('license')}>View license</button><button className="quick-help-link quick-help-quiet" onClick={() => setDialog('reset')}>Reset preferences</button></div></div></section>}
      {failures.filter(result => !(isProviderView && detail && result.key === detail.connectionKey)).map(result => <p className="quick-info" role="status" key={result.key}>{result.loading && !result.provider ? `Reading ${providerNames[result.id]}${result.label ? ` · ${result.label}` : ''}…` : `${providerNames[result.id]}${result.label ? ` · ${result.label}` : ''}: ${result.error}`}</p>)}
      {message && <p role="status" className="quick-info">{message}</p>}
    </div></div><footer className="quick-footer"><button className="quick-version" aria-label="Options" title="MeterLuma options" ref={optionsButton} aria-haspopup="menu" aria-expanded={options} aria-controls="quick-options" onClick={() => setOptions(value => !value)}>MeterLuma {APP_VERSION}<Icon name="chevron" size={11}/></button><button className="quick-update" aria-label="Refresh now" disabled={live.loading || additional.loading} title={`${updateHint}. Click to refresh now.`} onClick={refresh}>Next update in {nextRefresh}m</button></footer></div>
    {options && <div id="quick-options" className="quick-options" role="menu" aria-label="Options" ref={optionsMenu} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOptions(false); optionsButton.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = Array.from(optionsMenu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []); const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}><button role="menuitem" onClick={refresh}><Icon name="refresh" size={15}/>Refresh now</button><button role="menuitem" onClick={() => show('connections')}><Icon name="link" size={15}/>Connections</button><button role="menuitem" onClick={() => show('settings')}><Icon name="settings" size={15}/>Settings</button><button role="menuitem" onClick={() => { setOptions(false); if (isTauri()) void invoke('open_provider_page', { providerId: 'meterluma', page: 'repository' }).catch(() => setMessage('The repository could not be opened.')); else window.open('https://github.com/youssefrigale/MeterLuma', '_blank', 'noopener,noreferrer'); }}><Icon name="external" size={15}/>GitHub</button>{isTauri() && <><hr/><button role="menuitem" onClick={() => void invoke('quit_app').catch(() => setMessage('MeterLuma could not quit.'))}><Icon name="quit" size={15}/>Quit MeterLuma</button></>}</div>}
    {dialog === 'license' && <Modal title="Free for personal use." onClose={() => setDialog(null)}><p className="modal-intro">Personal, noncommercial use only. Selling and redistribution are prohibited. Third-party components retain their own licenses.</p><LegalMaterials/><button className="button primary full-width" onClick={() => setDialog(null)}>Done</button></Modal>}
    {dialog === 'reset' && <Modal title="Reset preferences?" onClose={() => setDialog(null)}><p className="modal-intro">Theme, display, time format, refresh interval, provider order and history window return to their defaults. Your connections, local accounts, usage alerts, notification choices and license acceptance are kept.</p><div className="legal-buttons dialog-actions"><button className="button primary" onClick={resetDisplay}>Reset preferences</button><button className="button" onClick={() => setDialog(null)}>Cancel</button></div></Modal>}
  </main>;
}
