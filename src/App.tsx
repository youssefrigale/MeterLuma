import { useEffect, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { Icon, Mark, type IconName } from './icons';
import { defaults, readSettings, sampleProviders, countdown, money, dailySpend, SETTINGS_KEY, type Settings, type Provider, type ProviderId } from './model';
import { ProviderCard } from './ProviderCard';
import { SpendChart } from './SpendChart';
import { Modal } from './Modal';

type Page = 'dashboard' | 'activity' | 'connections' | 'settings';
const pages: { id: Page; name: string; icon: IconName }[] = [
  { id: 'dashboard', name: 'Overview', icon: 'grid' },
  { id: 'activity', name: 'Activity', icon: 'activity' },
  { id: 'connections', name: 'Connections', icon: 'link' },
  { id: 'settings', name: 'Settings', icon: 'settings' },
];

export default function App() {
  const [settings, setSettings] = useState(readSettings);
  const [page, setPage] = useState<Page>('dashboard');
  const [anchor] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [refreshed, setRefreshed] = useState(Date.now);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<7 | 14>(14);
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<'pro' | 'connect' | ProviderId | null>(null);
  const allProviders = sampleProviders(anchor);
  const providers = settings.demo ? allProviders.filter(provider => settings.enabled.includes(provider.id)) : [];
  const spend = providers.reduce((sum, provider) => sum + provider.spendToday, 0);
  const nextReset = providers.flatMap(provider => provider.metrics.map(metric => ({ ...metric, provider: provider.name }))).filter(metric => metric.resetAt > now).sort((a, b) => a.resetAt - b.resetAt)[0];
  const detail = allProviders.find(provider => provider.id === dialog);

  function updateSettings(update: Partial<Settings>) { setSettings(current => ({ ...current, ...update })); }
  function refresh() { setRefreshing(true); setRefreshed(Date.now()); }
  function toggleProvider(id: ProviderId) {
    setSettings(current => ({ ...current, enabled: current.enabled.includes(id) ? current.enabled.filter(value => value !== id) : [...current.enabled, id] }));
  }

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
  useEffect(() => {
    if (!isTauri()) return;
    void invoke('set_tray_summary', { summary: settings.demo ? `Demo preview · ${providers.length} providers · ${money(spend)} sample spend today` : 'No live providers connected' }).catch(() => setToast('The tray summary could not be updated.'));
  }, [settings.demo, providers.length, spend]);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('dashboard'); }} aria-label="MeterLuma overview"><Mark/><span>Meter<span className="brand-luma">Luma</span></span></a>
      <div className="workspace-label">YOUR WORKSPACE <span>01</span></div>
      <nav aria-label="Main navigation">{pages.map(item => <button key={item.id} aria-label={item.name} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon}/><span>{item.name}</span>{item.id === 'connections' && <span className="nav-count" aria-hidden="true">{settings.enabled.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="pro-card"><div className="pro-card-title"><Icon name="spark"/><span>A little more insight.</span></div><p>More history. More accounts.<br/>A clearer picture.</p><button onClick={() => setDialog('pro')}>Discover Pro <Icon name="arrow" size={15}/></button></div><div className="local-label"><span className="tiny-dot"/> Local on your device <Icon name="info" size={13}/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <Icon name="chevron" size={12}/><span>{pages.find(item => item.id === page)?.name}</span></div><div className="topbar-right"><span className="demo-badge"><span/>{settings.demo ? 'Demo preview' : 'Setup mode'}</span><button className="icon-button theme-shortcut" aria-label="Toggle light and dark theme" onClick={() => updateSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}><Icon name={document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun'}/></button><span className="profile-mark">ML</span></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">{page === 'dashboard' ? 'A LITTLE CLARITY, EVERY DAY' : 'YOUR METERLUMA'}</p><h1>{page === 'dashboard' ? 'Your AI, in view.' : page === 'activity' ? 'See the bigger picture.' : page === 'connections' ? 'Everything, together.' : 'Make yourself at home.'}</h1><p className="page-subtitle">{page === 'dashboard' ? 'Less dashboard hopping. More room to create.' : page === 'activity' ? 'A closer look at where your usage goes.' : page === 'connections' ? 'Choose the AI tools you want to keep in view.' : 'Small adjustments. A workspace that feels like yours.'}</p></div>{(page === 'dashboard' || page === 'activity') && <button className="button refresh-button" onClick={refresh} disabled={refreshing}><Icon name="refresh" style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }}/>{refreshing ? 'Refreshing' : 'Refresh'}</button>}</div>

        {page === 'dashboard' && <>
          <div className="summary-grid"><div className="summary-item"><span className="summary-label">Providers in view <Icon name="grid" size={15}/></span><div className="summary-number">{providers.length.toString().padStart(2, '0')} <span>{providers.length ? 'sample connections' : 'connections'}</span></div></div><div className="summary-item"><span className="summary-label">Next reset <Icon name="clock" size={15}/></span><div className="summary-number">{nextReset ? countdown(nextReset.resetAt, now) : '—'} <span>{nextReset?.provider ?? 'No active windows'}</span></div></div><div className="summary-item"><span className="summary-label">Estimated spend today <span>USD</span></span><div className="summary-number">{money(spend)} <span>{settings.demo ? 'sample data' : 'No data yet'}</span></div></div></div>
          <div className="section-heading"><h2>Your providers <span>{providers.length}</span></h2><button className="text-button" onClick={() => setPage('connections')}>Manage <Icon name="arrow" size={14}/></button></div>
          {providers.length > 0 ? <div className="provider-grid">{providers.map(provider => <ProviderCard key={provider.id} provider={provider} remaining={settings.remaining} now={now} onDetails={() => setDialog(provider.id)}/>)}</div> : <EmptyState demo={settings.demo} onSetup={() => setPage('connections')} onDemo={() => updateSettings({ demo: true, enabled: [...defaults.enabled] })}/>}
          {providers.length > 0 && <div className="dashboard-lower"><section className="chart-card"><div className="section-heading"><div><h2>A little perspective</h2><p>Estimated daily spend · sample data</p></div><div className="segmented" aria-label="Chart date range">{([7, 14] as const).map(value => <button key={value} className={days === value ? 'selected' : ''} aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</button>)}</div></div><SpendChart providers={providers} days={days}/><div className="chart-legend">{providers.map(provider => <span key={provider.id}><i style={{ background: provider.color }}/>{provider.name}</span>)}</div></section><section className="insight-card"><div className="insight-icon"><Icon name="sun" size={25}/></div><p className="eyebrow">ROOM TO CREATE</p><h2>You have headroom.</h2><p>{providers.some(provider => provider.id === 'cursor') ? 'Your sample Cursor allowance is 76% used. Keep an eye on it as the month goes on.' : 'Your sample allowances still have room. Keep your reset windows in view while you work.'}</p><button className="text-button" onClick={() => updateSettings({ remaining: !settings.remaining })}><Icon name="eye" size={15}/>{settings.remaining ? 'Show usage instead' : 'Show remaining instead'}</button></section></div>}
        </>}

        {page === 'activity' && <>
          {providers.length ? <><section className="chart-card activity-chart"><div className="section-heading"><div><h2>Estimated spend</h2><p>Sample values, not subscription charges</p></div><div className="segmented">{([7, 14] as const).map(value => <button key={value} aria-pressed={days === value} className={days === value ? 'selected' : ''} onClick={() => setDays(value)}>{value} days</button>)}</div></div><SpendChart providers={providers} days={days}/></section><section className="panel activity-table"><div className="section-heading"><h2>By provider</h2><span className="muted">Last {days} days · sample</span></div><table><thead><tr><th>Provider</th><th>Estimated total</th><th>Today</th></tr></thead><tbody>{providers.map(provider => <tr key={provider.id}><td><span className="table-provider"><i style={{ background: provider.color }}/>{provider.name}</span></td><td>{money(dailySpend[provider.id].slice(-days).reduce((sum, value) => sum + value, 0))}</td><td>{money(provider.spendToday)}</td></tr>)}</tbody></table></section></> : <EmptyState demo={settings.demo} onSetup={() => setPage('connections')} onDemo={() => updateSettings({ demo: true, enabled: [...defaults.enabled] })}/>}
        </>}

        {page === 'connections' && <>
          <div className="notice"><Icon name="info"/><div><strong>This is an interactive preview.</strong><p>Live sign-in is not available in this build. Sample values let you explore the experience without sharing credentials.</p></div></div>
          <section className="panel"><SettingRow title="Demo preview" description="Explore MeterLuma with clearly labeled sample data."><Switch label="Demo preview" checked={settings.demo} onChange={() => updateSettings({ demo: !settings.demo })}/></SettingRow></section>
          <div className="connection-list">{allProviders.map(provider => <section className="connection-row panel" key={provider.id}><div className={`provider-logo ${provider.id}`} style={{ color: provider.color, background: `${provider.color}15` }}>{provider.initials}</div><div className="connection-copy"><h2>{provider.name}</h2><p>{provider.id === 'claude' ? 'Session & weekly allowance' : provider.id === 'codex' ? 'Session & weekly allowance' : 'Monthly allowance & spend'}</p><span className="connection-state">{settings.demo && settings.enabled.includes(provider.id) ? 'Sample data enabled' : 'Not connected'}</span></div><button className="button connection-options" onClick={() => setDialog('connect')}>Connection options</button><Switch label={`Show ${provider.name}`} checked={settings.enabled.includes(provider.id)} onChange={() => toggleProvider(provider.id)}/></section>)}</div>
          <p className="footnote"><Icon name="check" size={14}/>No provider credentials are read, requested, or stored by this preview.</p>
        </>}

        {page === 'settings' && <>
          <section className="panel settings-panel"><p className="eyebrow">APPEARANCE</p><SettingRow title="Theme" description="Choose your preferred light, or follow your device."><div className="segmented theme-control">{(['light', 'dark', 'system'] as const).map(theme => <button key={theme} aria-label={`${theme} theme`} aria-pressed={settings.theme === theme} className={settings.theme === theme ? 'selected' : ''} onClick={() => updateSettings({ theme })}><Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} size={15}/><span>{theme}</span></button>)}</div></SettingRow><SettingRow title="Show remaining allowance" description="Display what is left instead of what has been used."><Switch label="Show remaining allowance" checked={settings.remaining} onChange={() => updateSettings({ remaining: !settings.remaining })}/></SettingRow></section>
          <section className="panel settings-panel"><p className="eyebrow">REFRESH & DATA</p><SettingRow title="Demo refresh interval" description="Refresh the preview timestamp. Sample values stay fixed."><select aria-label="Demo refresh interval" value={settings.refreshMinutes} onChange={event => updateSettings({ refreshMinutes: Number(event.target.value) })}><option value="1">Every minute</option><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option></select></SettingRow><SettingRow title="Demo preview" description="Sample providers and spending. No live API requests."><Switch label="Demo preview" checked={settings.demo} onChange={() => updateSettings({ demo: !settings.demo })}/></SettingRow></section>
          <section className="panel about-panel"><Mark size={40}/><div><h2>MeterLuma <span className="version">0.1.0 prototype</span></h2><p>All your AI usage, one glance.</p><p className="muted">{isTauri() ? 'Desktop preview' : 'Browser preview'} · Settings saved on this device</p></div><div className="about-actions"><button className="text-button" onClick={() => setDialog('pro')}>Discover Pro</button><button className="text-button" onClick={() => { updateSettings({ ...defaults, enabled: [...defaults.enabled] }); setToast('Settings reset to their defaults.'); }}>Reset settings</button></div></section>
        </>}
        <footer className="main-footer"><span><span className="tiny-dot"/>{settings.demo ? 'Sample data only' : 'No live connections'}<span className="footer-separator">·</span> {settings.demo ? `Refreshed ${new Date(refreshed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Ready for setup'}</span><span>Made for a little peace of mind.</span></footer>
      </main>
    </div>
    {toast && <div role="status" className="toast"><Icon name="check" size={16}/>{toast}</div>}
    {dialog === 'pro' && <Modal title="A clearer picture with Pro." onClose={() => setDialog(null)}><div className="modal-pro-mark"><Icon name="spark" size={32}/></div><p className="modal-intro">The everyday essentials stay free. Pro is planned as a one-time purchase, with more room for insight.</p><ul className="feature-list"><li><Icon name="check"/>Longer usage history and trends</li><li><Icon name="check"/>Multiple accounts per provider</li><li><Icon name="check"/>Custom alerts and exports</li></ul><div className="notice compact"><Icon name="info"/><p>Pro is planned. Purchasing, billing, and these features are not available in this prototype.</p></div><button className="button primary full-width" onClick={() => setDialog(null)}>Back to my workspace <Icon name="arrow" size={16}/></button></Modal>}
    {dialog === 'connect' && <Modal title="Live connections are next." onClose={() => setDialog(null)}><p className="modal-intro">This build is for exploring the app. It does not connect to provider accounts yet.</p><div className="notice compact"><Icon name="info"/><p>Future connections will use provider-specific sign-in and secure storage on your operating system. There is no token field in this preview.</p></div><button className="button primary full-width" onClick={() => { updateSettings({ demo: true }); setDialog(null); }}>Explore sample data <Icon name="arrow" size={16}/></button></Modal>}
    {detail && <Modal title={`${detail.name} at a glance`} onClose={() => setDialog(null)}><div className="detail-header"><div className={`provider-logo ${detail.id}`} style={{ color: detail.color }}>{detail.initials}</div><div><h3>{detail.plan} plan</h3><span className="muted">Sample account · demo data</span></div></div><div className="detail-metrics">{detail.metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{100 - metric.usedPercent}% remaining</strong><small>Resets in {countdown(metric.resetAt, now)}</small></div>)}</div><div className="detail-spend"><span>Estimated spend today</span><strong>{money(detail.spendToday)}</strong></div><p className="footnote">Sample estimate in USD. This is not an actual subscription charge.</p></Modal>}
  </div>;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <button role="switch" aria-label={label} aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={onChange}><span/></button>;
}
function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><h2>{title}</h2><p>{description}</p></div>{children}</div>;
}
function EmptyState({ demo, onSetup, onDemo }: { demo: boolean; onSetup: () => void; onDemo: () => void }) {
  return <section className="empty-state panel"><div className="empty-mark"><Mark size={42}/></div><h2>{demo ? 'Choose your first provider.' : 'A fresh start.'}</h2><p>{demo ? 'Enable a provider in Connections to see its sample usage.' : 'Live connections are still being built. Explore the preview with sample data in the meantime.'}</p><div><button className="button primary" onClick={onDemo}>Explore demo <Icon name="arrow" size={15}/></button><button className="button" onClick={onSetup}>Manage providers</button></div></section>;
}
