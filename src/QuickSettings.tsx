import { DEMO_AVAILABLE, type Provider, type Settings } from './model';
import { Icon } from './icons';
import { ActivityTools } from './ActivityTools';
import { AlertSettings } from './Alerts';
import { PreferenceTransfer } from './PreferenceTransfer';
import { DesktopPreferences } from './DesktopPreferences';
import { PanelShortcutSettings } from './PanelShortcutSettings';
import type { usePanelShortcut } from './usePanelShortcut';
import { PinnedPanelSettings } from './PinnedPanelSettings';
import { NotificationSettings } from './NotificationSettings';
import { OverviewLayoutSettings } from './OverviewLayoutSettings';
import type { useUsageNotifications } from './useUsageNotifications';

export function QuickSettings({ settings, update, catalog, providers, connect, shortcut, notifications }: { notifications: ReturnType<typeof useUsageNotifications>; shortcut: ReturnType<typeof usePanelShortcut>; settings: Settings; update: (value: Partial<Settings>) => boolean; catalog: Provider[]; providers: Provider[]; connect: () => void }) {
  function reorder(index: number, direction: number) {
    const order = [...settings.providerOrder];
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    update({ providerOrder: order });
  }
  return <div className="quick-settings">
    <DesktopPreferences/>
    <PanelShortcutSettings shortcut={shortcut}/>
    <PinnedPanelSettings/>
    <section><h2>Auto refresh</h2><p>Keep your allowances up to date.</p><div className="quick-choice">{[5, 15, 30, 60].map(minutes => <button key={minutes} aria-pressed={settings.refreshMinutes === minutes} onClick={() => update({ refreshMinutes: minutes })}>{minutes === 60 ? '1 hour' : `${minutes} min`}</button>)}</div></section>
    <section><h2>Usage mode</h2><p>Choose what the bars show.</p><div className="quick-choice">{[true, false].map(remaining => <button key={String(remaining)} aria-pressed={settings.remaining === remaining} onClick={() => update({ remaining })}>{remaining ? 'Left' : 'Used'}</button>)}</div></section>
    <section><h2>Menu bar allowance</h2><p>Choose which returned quota to show. Falls back to the first available window.</p><div className="quick-choice">{(['session','weekly','lowest'] as const).map(trayMetric=><button key={trayMetric} aria-pressed={(settings.trayMetric ?? 'session')===trayMetric} onClick={()=>update({trayMetric})}>{trayMetric==='session'?'Session':trayMetric==='weekly'?'Weekly':'Lowest left'}</button>)}</div></section>
    <section className="quick-menu-bar-providers"><h2>Menu bar providers</h2><p>Show the provider you have open, or several side by side in sidebar order. Cached readings appear dimmed.</p><div className="quick-choice">{([1, 3, 5] as const).map(trayProviders => <button key={trayProviders} aria-pressed={(settings.trayProviders ?? 1) === trayProviders} onClick={() => update({ trayProviders })}>{trayProviders === 1 ? 'One' : `Up to ${trayProviders}`}</button>)}</div></section>
    <section><h2>Usage projection</h2><label className="quick-check"><input type="checkbox" checked={settings.pacing === true} onChange={()=>update({pacing:!settings.pacing})}/>Show pace when the window duration is known</label><p>A straight-line estimate from usage so far. Work patterns can change; this is not a promised allowance.</p></section>
    <section><h2>Overview spacing</h2><label className="quick-check"><input type="checkbox" checked={settings.compactOverview === true} onChange={()=>update({compactOverview:!settings.compactOverview})}/>Compact overview</label><p>Keep the same readings with less space between providers and quota rows.</p></section>
    <section><h2>Reset timers</h2><p>Countdown or a date and time.</p><div className="quick-choice">{(['relative', 'absolute'] as const).map(resetStyle => <button key={resetStyle} aria-pressed={settings.resetStyle === resetStyle} onClick={() => update({ resetStyle })}>{resetStyle === 'relative' ? 'Relative' : 'Absolute'}</button>)}</div></section>
    <section><h2>Time format</h2><div className="quick-choice">{(['auto', '12', '24'] as const).map(timeFormat => <button key={timeFormat} aria-pressed={settings.timeFormat === timeFormat} onClick={() => update({ timeFormat })}>{timeFormat === 'auto' ? 'Auto' : `${timeFormat}-hour`}</button>)}</div></section>
    <section><h2>Appearance</h2><p>System follows your device automatically.</p><div className="quick-choice">{(['system', 'light', 'dark'] as const).map(theme => <button key={theme} aria-label={`${theme} theme`} aria-pressed={settings.theme === theme} onClick={() => update({ theme })}>{theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></section>
    <section><h2>Providers</h2><p>Show, hide, and arrange your lineup.</p><div className="quick-provider-settings">{settings.providerOrder.map((id, index) => {
      const provider = catalog.find(provider => provider.id === id)!;
      return <div key={id}><label><input type="checkbox" checked={settings.enabled.includes(id)} onChange={() => update({ enabled: settings.enabled.includes(id) ? settings.enabled.filter(value => value !== id) : [...settings.enabled, id] })}/><span>{provider.name}</span></label><button aria-label={`Move ${provider.name} up`} disabled={index === 0} onClick={() => reorder(index, -1)}><Icon name="up" size={19}/></button><button aria-label={`Move ${provider.name} down`} disabled={index === settings.providerOrder.length - 1} onClick={() => reorder(index, 1)}><Icon name="down" size={19}/></button></div>;
    })}</div><button className="quick-text-button" onClick={connect}>Manage connections <Icon name="arrow" size={14}/></button><p className="quick-info">Additional connections are available under More providers.</p></section>
    <OverviewLayoutSettings settings={settings} update={update}/>
    <ActivityTools settings={settings} providers={providers} update={update}/>
    <AlertSettings settings={settings} update={update}/>
    <NotificationSettings notifications={notifications}/>
    <PreferenceTransfer settings={settings} update={update}/>
    {DEMO_AVAILABLE && <section><h2>Demo preview</h2><label className="quick-check"><input type="checkbox" checked={settings.demo} onChange={() => update({ demo: !settings.demo })}/>Use sample data</label><p>Turn off to use your connected accounts.</p></section>}
  </div>;
}
