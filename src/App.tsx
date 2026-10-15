import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Icon, Mark, type IconName } from './icons';
import { DEMO_AVAILABLE, defaults, readSettings, resetPreferences, sampleProviders, countdown, money, dailySpend, SETTINGS_KEY, type Settings, type ProviderId } from './model';
import { ProviderCard } from './ProviderCard';
import { SpendChart } from './SpendChart';
import { Modal } from './Modal';
import { useLiveProviders } from './useLiveProviders';
import { ProviderLogo } from './ProviderLogo';
import { UsageHistory } from './UsageHistory';
import { retryCountdown } from './providerState';
import { LegalMaterials, LicenseGate } from './LegalNotice';
import { AccountProfiles } from './AccountProfiles';
import { ActivityTools } from './ActivityTools';
import { AlertSettings, UsageAlerts } from './Alerts';
import { APP_VERSION, CLAUDE_LOCAL, CURSOR_UNOFFICIAL, formatDateTime, formatTime, plural, providerNames, resetText, visibleMetrics } from './format';
import { estimatedValue } from './coverage';
import { NotAffiliated, UnofficialBadge, UnofficialNote } from './ProviderNotes';
import { CURSOR_HISTORY_NOTE } from './exportUsage';

type Page = 'dashboard' | 'activity' | 'connections' | 'settings';
const pages: { id: Page; name: string; icon: IconName }[] = [
  { id: 'dashboard', name: 'Overview', icon: 'grid' },
  { id: 'activity', name: 'Activity', icon: 'activity' },
  { id: 'connections', name: 'Connections', icon: 'link' },
  { id: 'settings', name: 'Settings', icon: 'settings' },
];
const descriptions: Record<ProviderId, string> = { claude: 'Recorded token history from local Claude Code logs · no quotas', codex: 'Official CLI quotas & recorded activity', cursor: 'Monthly allowance' };
const connectIntro: Record<ProviderId, string> = { claude: 'Show recorded Claude Code token history from this device.', codex: 'Use the Codex CLI installed on this device.', cursor: 'Use your existing Cursor desktop sign-in on this device.' };
const connectDetail: Record<ProviderId, string> = {
  claude: `${CLAUDE_LOCAL} Claude quotas are not shown. Days older than Claude Code keeps its logs (30 days by default) are marked as not recorded.`,
  codex: 'MeterLuma asks the installed official Codex CLI app-server for your limits and reads recorded token counts from local Codex session logs. No token is copied into settings or sent to MeterLuma servers.',
  cursor: 'MeterLuma reads your existing Cursor sign-in in the native process and sends it only to Cursor to fetch your monthly allowance. No token is copied into settings or sent to MeterLuma servers. Cached quotas keep their original fetch time.',
};

export default function App() {
  const [settings, setSettings] = useState(readSettings);
  const [page, setPage] = useState<Page>(() => {
    const requested = new URLSearchParams(window.location.search).get('page');
    return pages.some(page => page.id === requested) ? requested as Page : 'dashboard';
  });
  const [anchor] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [refreshed, setRefreshed] = useState(Date.now);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<7 | 14>(14);
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<ProviderId>('claude');
  const allProviders = sampleProviders(anchor);
  const live = useLiveProviders(settings);
  const providers = (settings.demo ? allProviders.filter(provider => settings.enabled.includes(provider.id)) : live.results.flatMap(result => result.provider ? [result.provider] : [])).sort((a, b) => settings.providerOrder.indexOf(a.id) - settings.providerOrder.indexOf(b.id));
  const spend = providers.reduce((sum, provider) => sum + (provider.spendToday ?? 0), 0);
  const todayValues = providers.flatMap(provider => { const value = estimatedValue(provider.history, 'Today'); return value ? [value.cost] : []; });
  const nextReset = providers.flatMap(provider => visibleMetrics(provider, now).flatMap(metric => metric.resetAt !== null && metric.resetAt > now ? [{ resetAt: metric.resetAt, provider: provider.name }] : [])).sort((a, b) => a.resetAt - b.resetAt)[0];
  const detail = (settings.demo ? allProviders : providers).find(provider => (provider.connectionKey ?? provider.id) === dialog);
  const busy = settings.demo ? refreshing : live.loading;
  const connected = settings.liveProviders.length + settings.profiles.length;
  const liveCount = providers.filter(provider => provider.fetchedAt && !provider.cached).length;
  const statuses = settings.demo ? [] : live.results.filter(result => (result.loading && !result.provider) || result.error);
  const historyProviders = providers.filter(provider => provider.history?.available);

  function updateSettings(update: Partial<Settings>) { setSettings(current => ({ ...current, ...update })); }
  function refresh() { if (settings.demo) { setRefreshing(true); setRefreshed(Date.now()); } else { live.refresh(); } }
  function toggleProvider(id: ProviderId) {
    setSettings(current => ({ ...current, enabled: current.enabled.includes(id) ? current.enabled.filter(value => value !== id) : [...current.enabled, id] }));
  }
  function connectionState(id: ProviderId) {
    if (settings.demo) return settings.enabled.includes(id) ? 'Sample data enabled' : 'Not connected';
    const accounts = settings.profiles.filter(profile => profile.providerId === id).length;
    if (!settings.liveProviders.includes(id)) return accounts ? `${plural(accounts, 'local account')} connected` : 'Not connected';
    const result = live.results.find(row => row.key === id);
    if (id === 'claude') return result?.provider?.history?.available ? 'Connected · local history' : result?.loading ? 'Reading local history…' : 'Local profile selected';
    if (result?.provider?.cached) return result.quotaFailure?.code === 'rate_limited' ? 'Rate limited (cached)' : 'Cached quotas';
    if (result?.provider?.fetchedAt) return 'Connected';
    return result?.quotaFailure?.code === 'rate_limited' ? 'Local profile selected · rate limited' : 'Local profile selected';
  }

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>('meterluma:navigate', event => {
      if (pages.some(page => page.id === event.payload)) setPage(event.payload as Page);
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SETTINGS_KEY) setSettings(readSettings()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch { setToast('Your settings could not be saved on this device.'); }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = settings.theme === 'system' ? media.matches ? 'dark' : 'light' : settings.theme; };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!refreshing) return;
    const timer = window.setTimeout(() => { setRefreshing(false); setToast(settings.demo ? 'Demo refreshed. Sample values are unchanged.' : 'No live providers connected yet.'); }, 450);
    return () => clearTimeout(timer);
  }, [refreshing, settings.demo]);
  useEffect(() => {
    if (!settings.demo) return;
    const timer = window.setInterval(() => setRefreshed(Date.now()), settings.refreshMinutes * 60_000);
    return () => clearInterval(timer);
  }, [settings.demo, settings.refreshMinutes]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('dashboard'); }} aria-label="MeterLuma overview"><Mark/><span>Meter<span className="brand-luma">Luma</span></span></a>
      <div className="workspace-label">YOUR WORKSPACE <span>01</span></div>
      <nav aria-label="Main navigation">{pages.map(item => <button key={item.id} aria-label={item.name} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} size={20} selected={page === item.id}/><span>{item.name}</span>{item.id === 'connections' && <span className="nav-count" aria-hidden="true">{settings.demo ? settings.enabled.length : connected}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="license-card"><div className="license-card-title"><Icon name="info"/><span>Free for personal use.</span></div><p>Personal, noncommercial use only.<br/>No redistribution.</p><button onClick={() => setDialog('license')}>View license <Icon name="arrow" size={15}/></button></div><div className="local-label"><span className="tiny-dot"/> Local on your device <Icon name="info" size={13}/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <Icon name="chevron" size={12}/><span>{pages.find(item => item.id === page)?.name}</span></div><div className="topbar-right"><span className="demo-badge"><span/>{DEMO_AVAILABLE && settings.demo ? 'Demo preview' : connected ? 'Live mode' : 'Setup mode'}</span><button className="icon-button theme-shortcut" aria-label="Toggle light and dark theme" onClick={() => updateSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}><Icon name={document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun'}/></button><span className="profile-mark">ML</span></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">{page === 'dashboard' ? 'A LITTLE CLARITY, EVERY DAY' : 'YOUR METERLUMA'}</p><h1>{page === 'dashboard' ? 'Your AI, in view.' : page === 'activity' ? 'See the bigger picture.' : page === 'connections' ? 'Everything, together.' : 'Make yourself at home.'}</h1><p className="page-subtitle">{page === 'dashboard' ? 'Less dashboard hopping. More room to create.' : page === 'activity' ? 'A closer look at where your usage goes.' : page === 'connections' ? 'Choose the AI tools you want to keep in view.' : 'Small adjustments. A workspace that feels like yours.'}</p></div>{(page === 'dashboard' || page === 'activity') && <button className="button refresh-button" onClick={refresh} disabled={busy}><Icon name="refresh" style={{ animation: busy ? 'spin 1s linear infinite' : undefined }}/>{busy ? 'Refreshing' : 'Refresh'}</button>}</div>

        {page === 'dashboard' && <>
          <UsageAlerts settings={settings} providers={providers} now={now}/>
          <div className="summary-grid"><div className="summary-item"><span className="summary-label">Providers in view <Icon name="grid" size={15}/></span><div className="summary-number">{providers.length.toString().padStart(2, '0')} <span>{settings.demo ? 'sample profiles' : 'local profiles'}</span></div></div><div className="summary-item"><span className="summary-label">Next reset <Icon name="clock" size={15}/></span><div className="summary-number">{nextReset ? countdown(nextReset.resetAt, now) : '—'} <span>{nextReset?.provider ?? 'No reset time reported'}</span></div></div><div className="summary-item"><span className="summary-label">{settings.demo ? 'Estimated spend today' : 'Estimated API value today'} <span>USD</span></span><div className="summary-number">{settings.demo ? money(spend) : todayValues.length ? `~${money(todayValues.reduce((sum, value) => sum + value, 0))}` : '—'} <span>{settings.demo ? 'sample data' : todayValues.length ? 'recorded tokens · not a bill' : 'No priced history yet'}</span></div></div></div>
          <div className="section-heading"><h2>Your providers <span>{providers.length}</span></h2><button className="text-button" onClick={() => setPage('connections')}>Manage <Icon name="arrow" size={14}/></button></div>
          {statuses.length > 0 && <div className="live-status-list">{statuses.map(result => <div className="notice" key={result.key}><Icon name={result.loading && !result.provider ? 'refresh' : 'info'}/><div><strong>{providerNames[result.id]}{result.label ? ` · ${result.label}` : ''}</strong><p>{result.loading && !result.provider ? result.id === 'claude' ? 'Reading recorded Claude Code history…' : 'Reading recorded usage and available quotas…' : result.quotaFailure?.retryAt && result.quotaFailure.retryAt > now ? `Usage requests are rate limited. Retrying in ${retryCountdown(result.quotaFailure.retryAt, now)}.` : result.error}</p></div></div>)}</div>}
          {providers.length > 0 ? <div className="provider-grid">{providers.map(provider => <ProviderCard key={provider.connectionKey ?? provider.id} provider={provider} remaining={settings.remaining} now={now} demo={settings.demo} display={settings} onDetails={() => setDialog(provider.connectionKey ?? provider.id)}/>)}</div> : !live.loading && <EmptyState demo={settings.demo} onSetup={() => setPage('connections')} onDemo={() => updateSettings({ demo: true, enabled: [...defaults.enabled] })}/>}
          {settings.demo && providers.length > 0 && <div className="dashboard-lower"><section className="chart-card"><div className="section-heading"><div><h2>A little perspective</h2><p>Estimated daily spend · sample data</p></div><div className="segmented" aria-label="Chart date range">{([7, 14] as const).map(value => <button key={value} className={days === value ? 'selected' : ''} aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</button>)}</div></div><SpendChart providers={providers} days={days}/><div className="chart-legend">{providers.map(provider => <span key={provider.id}><i style={{ background: provider.color }}/>{provider.name}</span>)}</div></section><section className="insight-card"><div className="insight-icon"><Icon name="sun" size={25}/></div><p className="eyebrow">ROOM TO CREATE</p><h2>You have headroom.</h2><p>{providers.some(provider => provider.id === 'cursor') ? 'Your sample Cursor allowance is 76% used. Keep an eye on it as the month goes on.' : 'Your sample allowances still have room. Keep your reset windows in view while you work.'}</p><button className="text-button" onClick={() => updateSettings({ remaining: !settings.remaining })}><Icon name="eye" size={15}/>{settings.remaining ? 'Show usage instead' : 'Show remaining instead'}</button></section></div>}
        </>}

        {page === 'activity' && <>
          <ActivityTools settings={settings} providers={providers} update={updateSettings}/>
          {settings.demo && providers.length ? <><section className="chart-card activity-chart"><div className="section-heading"><div><h2>Estimated spend</h2><p>Sample values, not subscription charges</p></div><div className="segmented">{([7, 14] as const).map(value => <button key={value} aria-pressed={days === value} className={days === value ? 'selected' : ''} onClick={() => setDays(value)}>{value} days</button>)}</div></div><SpendChart providers={providers} days={days}/></section><section className="panel activity-table"><div className="section-heading"><h2>By provider</h2><span className="muted">Last {days} days · sample</span></div><table><thead><tr><th>Provider</th><th>Estimated total</th><th>Today</th></tr></thead><tbody>{providers.map(provider => <tr key={provider.id}><td><span className="table-provider"><i style={{ background: provider.color }}/>{provider.name}</span></td><td>{money(dailySpend[provider.id].slice(-days).reduce((sum, value) => sum + value, 0))}</td><td>{provider.spendToday === null ? '—' : money(provider.spendToday)}</td></tr>)}</tbody></table></section></>
            : historyProviders.length ? <div className="provider-grid">{historyProviders.map(provider => <section className="panel history-panel" key={provider.connectionKey ?? provider.id}><h2>{provider.name}{provider.accountLabel ? ` · ${provider.accountLabel}` : ''}</h2><UsageHistory history={provider.history!} providerId={provider.id} timeFormat={settings.timeFormat}/></section>)}</div>
            : live.loading ? <section className="empty-state panel" aria-busy="true"><h2>Reading recorded activity…</h2><p>Scanning local logs on this device. Nothing leaves your device.</p></section>
            : <section className="empty-state panel"><h2>No recorded activity yet.</h2><p>{providers.length && providers.every(provider => provider.id === 'cursor') ? `${CURSOR_HISTORY_NOTE} Recorded token history is available for Claude Code and Codex.` : 'Select a local Claude Code or Codex profile in Connections to read its recorded activity. Live quotas and recorded history are separate data sources.'}</p>{DEMO_AVAILABLE && <button className="button" onClick={() => updateSettings({ demo: true })}>Explore the demo chart</button>}</section>}
        </>}

        {page === 'connections' && <>
          <div className="notice"><Icon name="info"/><div><strong>{isTauri() ? 'Use what is already on your device.' : 'Explore here. Connect in the desktop app.'}</strong><p>{isTauri() ? 'Codex quotas come from its official CLI. Cursor uses your local Cursor sign-in with an unofficial endpoint. Claude is read only from local Claude Code logs, without its sign-in.' : 'This browser preview uses sample data. Live connections run in the Mac and Windows desktop app.'}</p></div></div>
          {DEMO_AVAILABLE && <section className="panel"><SettingRow title="Demo preview" description="Explore MeterLuma with clearly labeled sample data."><Switch label="Demo preview" checked={settings.demo} onChange={() => updateSettings({ demo: !settings.demo })}/></SettingRow></section>}
          <div className="connection-list">{allProviders.map(provider => <section className="connection-row panel" key={provider.id}><div className={`provider-logo ${provider.id}`}><ProviderLogo id={provider.id}/></div><div className="connection-copy"><div className="connection-title"><h2>{provider.name}</h2>{provider.id === 'cursor' && <UnofficialBadge/>}</div><p>{descriptions[provider.id]}</p>{provider.id === 'cursor' && <p className="unofficial-line">{CURSOR_UNOFFICIAL}</p>}<span className="connection-state">{connectionState(provider.id)}</span></div>{settings.liveProviders.includes(provider.id) ? <button className="button connection-options" onClick={() => updateSettings({ liveProviders: settings.liveProviders.filter(id => id !== provider.id) })}>Disconnect {provider.name}</button> : <button className="button connection-options" onClick={() => { setPendingProvider(provider.id); setDialog('connect'); }}>Connect {provider.name}</button>}<Switch label={`Show ${provider.name}`} checked={settings.enabled.includes(provider.id)} onChange={() => toggleProvider(provider.id)}/></section>)}</div>
          <AccountProfiles settings={settings} update={updateSettings}/>
          <p className="footnote"><Icon name="check" size={14}/>{settings.demo ? 'Demo mode does not read provider credentials or make usage requests.' : "Cursor's sign-in stays in the native process and is sent only to Cursor. Codex uses its official CLI. Claude is read from local logs only; MeterLuma never reads the Claude sign-in or contacts Anthropic. Tokens are never copied into settings."}</p>
          <NotAffiliated className="footnote"/>
        </>}

        {page === 'settings' && <>
          <section className="panel settings-panel"><p className="eyebrow">APPEARANCE</p><SettingRow title="Theme" description="Follow your device, or choose a light or dark theme."><div className="segmented theme-control">{(['system', 'light', 'dark'] as const).map(theme => <button key={theme} aria-label={`${theme} theme`} aria-pressed={settings.theme === theme} className={settings.theme === theme ? 'selected' : ''} onClick={() => updateSettings({ theme })}><Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} size={15}/><span>{theme}</span></button>)}</div></SettingRow><SettingRow title="Show remaining allowance" description="Display what is left instead of what has been used."><Switch label="Show remaining allowance" checked={settings.remaining} onChange={() => updateSettings({ remaining: !settings.remaining })}/></SettingRow><SettingRow title="Reset timers" description="Show a countdown, or the date and time of the next reset."><div className="segmented" role="group" aria-label="Reset timers">{(['relative', 'absolute'] as const).map(resetStyle => <button key={resetStyle} aria-pressed={settings.resetStyle === resetStyle} className={settings.resetStyle === resetStyle ? 'selected' : ''} onClick={() => updateSettings({ resetStyle })}>{resetStyle === 'relative' ? 'Countdown' : 'Date and time'}</button>)}</div></SettingRow><SettingRow title="Time format" description="Used for every time shown in MeterLuma."><div className="segmented" role="group" aria-label="Time format">{(['auto', '12', '24'] as const).map(timeFormat => <button key={timeFormat} aria-pressed={settings.timeFormat === timeFormat} className={settings.timeFormat === timeFormat ? 'selected' : ''} onClick={() => updateSettings({ timeFormat })}>{timeFormat === 'auto' ? 'Auto' : `${timeFormat}-hour`}</button>)}</div></SettingRow></section>
          <section className="panel settings-panel"><p className="eyebrow">REFRESH & DATA</p><SettingRow title="Refresh interval" description={settings.demo ? 'Refresh the preview timestamp. Sample values stay fixed.' : 'Choose how often live usage refreshes.'}><select aria-label="Refresh interval" value={settings.demo ? settings.refreshMinutes : Math.max(5, settings.refreshMinutes)} onChange={event => updateSettings({ refreshMinutes: Number(event.target.value) })}><option value="1" disabled={!settings.demo}>Every minute</option><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option></select></SettingRow>{DEMO_AVAILABLE && <SettingRow title="Demo preview" description="Sample providers and spending. No live API requests."><Switch label="Demo preview" checked={settings.demo} onChange={() => updateSettings({ demo: !settings.demo })}/></SettingRow>}</section>
          <AlertSettings settings={settings} update={updateSettings}/>
          <section className="panel about-panel"><Mark size={40}/><div><h2>MeterLuma <span className="version">v{APP_VERSION}{import.meta.env.DEV ? ' · development build' : ''}</span></h2><p>All your AI usage, one glance.</p><p className="muted">{isTauri() ? 'Desktop app' : 'Browser preview'} · Settings saved on this device</p><NotAffiliated className="muted"/></div><div className="about-actions"><button className="text-button" onClick={() => setDialog('license')}>View license</button><button className="text-button" onClick={() => setDialog('reset')}>Reset preferences</button></div></section>
        </>}
        <footer className="main-footer"><span><span className="tiny-dot"/>{settings.demo ? 'Sample data only' : plural(liveCount, 'live connection')}<span className="footer-separator">·</span> {settings.demo ? `Refreshed ${formatTime(refreshed, settings.timeFormat)}` : live.updatedAt ? `Updated ${formatTime(live.updatedAt, settings.timeFormat)}` : connected && live.loading ? 'Reading usage…' : 'Ready for setup'}</span><span>Made for a little peace of mind.</span></footer>
      </main>
    </div>
    <LicenseGate settings={settings} update={updateSettings}/>
    {toast && <div role="status" className="toast"><Icon name="check" size={16}/>{toast}</div>}
    {dialog === 'license' && <Modal title="Free for personal use." onClose={() => setDialog(null)}><p className="modal-intro">Personal, noncommercial use only. Selling and redistribution are prohibited. Third-party components retain their own licenses.</p><LegalMaterials/><button className="button primary full-width" onClick={() => setDialog(null)}>Back to my workspace <Icon name="arrow" size={16}/></button></Modal>}
    {dialog === 'reset' && <Modal title="Reset preferences?" onClose={() => setDialog(null)}><p className="modal-intro">Theme, display, time format, refresh interval, provider order and history window return to their defaults. Your connections, local accounts, usage alerts and license acceptance are kept.</p><div className="legal-buttons dialog-actions"><button className="button primary" onClick={() => { updateSettings(resetPreferences(settings)); setDialog(null); setToast('Preferences reset. Connections, alerts and consent were kept.'); }}>Reset preferences</button><button className="button" onClick={() => setDialog(null)}>Cancel</button></div></Modal>}
    {dialog === 'connect' && <Modal title={isTauri() ? `Connect ${providerNames[pendingProvider]}` : 'Connect in the desktop app.'} onClose={() => setDialog(null)}><p className="modal-intro">{isTauri() ? connectIntro[pendingProvider] : 'Live account connections need the MeterLuma desktop app. This browser preview does not access your local sign-ins.'}</p><div className="notice compact"><Icon name="info"/><p>{isTauri() ? connectDetail[pendingProvider] : 'You can explore the interface using labeled sample data. No provider tokens are requested here.'}</p></div>{isTauri() && pendingProvider === 'cursor' && <UnofficialNote className="modal-note"/>}<button className="button primary full-width" onClick={() => { if (isTauri()) { updateSettings({ demo: false, liveProviders: [...new Set([...settings.liveProviders, pendingProvider])], enabled: [...new Set([...settings.enabled, pendingProvider])] }); setPage('dashboard'); } else { updateSettings({ demo: true }); } setDialog(null); }}>{isTauri() ? 'Use local profile' : 'Explore sample data'} <Icon name="arrow" size={16}/></button></Modal>}
    {detail && <Modal title={`${detail.name} at a glance`} onClose={() => setDialog(null)}><div className="detail-header"><div className={`provider-logo ${detail.id}`}><ProviderLogo id={detail.id}/></div><div><h3>{detail.historyOnly || !detail.fetchedAt ? 'Recorded activity' : `${detail.plan} plan`}</h3><span className="muted">{settings.demo ? 'Sample account · demo data' : detail.historyOnly ? 'Local history only · no quotas' : detail.cached ? `Cached quotas · fetched ${formatDateTime(detail.fetchedAt!, settings.timeFormat)}` : detail.fetchedAt ? 'Live plan limits' : detail.quotaState === 'rate_limited' ? 'Live quotas are rate limited' : 'Live quotas unavailable'}</span></div></div>
      {detail.id === 'cursor' && <UnofficialNote className="modal-note"/>}
      {detail.historyOnly ? <><p className="modal-intro">{CLAUDE_LOCAL}</p>{detail.history?.available && <UsageHistory history={detail.history} providerId={detail.id} timeFormat={settings.timeFormat}/>}</>
        : visibleMetrics(detail, now).length ? <div className="detail-metrics">{visibleMetrics(detail, now).map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{Math.max(0, 100 - metric.usedPercent).toLocaleString(undefined, { maximumFractionDigits: 1 })}% remaining</strong><small>{resetText(metric, now, settings)}</small></div>)}</div> : <p className="modal-intro">Live allowances are unavailable right now.</p>}
      {detail.spendToday !== null && <><div className="detail-spend"><span>Estimated spend today</span><strong>{money(detail.spendToday)}</strong></div><p className="footnote">Sample estimate in USD. This is not an actual subscription charge.</p></>}</Modal>}
  </div>;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <button role="switch" aria-label={label} aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={onChange}><span/></button>;
}
function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><h2>{title}</h2><p>{description}</p></div>{children}</div>;
}
function EmptyState({ demo, onSetup, onDemo }: { demo: boolean; onSetup: () => void; onDemo: () => void }) {
  return <section className="empty-state panel"><div className="empty-mark"><Mark size={42}/></div><h2>{demo ? 'Choose your first provider.' : 'A fresh start.'}</h2><p>{demo ? 'Enable a provider in Connections to see its sample usage.' : isTauri() ? 'Connect a provider in Connections to read its usage. Any connection issues are shown above.' : 'Live connections run in the desktop app. Explore sample data in this browser preview.'}</p><div>{DEMO_AVAILABLE && <button className="button primary" onClick={onDemo}>Explore demo <Icon name="arrow" size={15}/></button>}<button className="button" onClick={onSetup}>Manage providers</button></div></section>;
}
