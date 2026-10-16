import { DEMO_AVAILABLE, type Provider, type Settings } from './model';
import { Icon } from './icons';
import { ActivityTools } from './ActivityTools';
import { AlertSettings } from './Alerts';

export function QuickSettings({ settings, update, catalog, providers, connect }: { settings: Settings; update: (value: Partial<Settings>) => void; catalog: Provider[]; providers: Provider[]; connect: () => void }) {
  function reorder(index: number, direction: number) {
    const order = [...settings.providerOrder];
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    update({ providerOrder: order });
  }
  return <div className="quick-settings">
    <section><h2>Auto refresh</h2><p>Keep your allowances up to date.</p><div className="quick-choice">{[5, 15, 30, 60].map(minutes => <button key={minutes} aria-pressed={settings.refreshMinutes === minutes} onClick={() => update({ refreshMinutes: minutes })}>{minutes === 60 ? '1 hour' : `${minutes} min`}</button>)}</div></section>
    <section><h2>Usage mode</h2><p>Choose what the bars show.</p><div className="quick-choice">{[true, false].map(remaining => <button key={String(remaining)} aria-pressed={settings.remaining === remaining} onClick={() => update({ remaining })}>{remaining ? 'Left' : 'Used'}</button>)}</div></section>
    <section><h2>Reset timers</h2><p>Countdown or a date and time.</p><div className="quick-choice">{(['relative', 'absolute'] as const).map(resetStyle => <button key={resetStyle} aria-pressed={settings.resetStyle === resetStyle} onClick={() => update({ resetStyle })}>{resetStyle === 'relative' ? 'Relative' : 'Absolute'}</button>)}</div></section>
    <section><h2>Time format</h2><div className="quick-choice">{(['auto', '12', '24'] as const).map(timeFormat => <button key={timeFormat} aria-pressed={settings.timeFormat === timeFormat} onClick={() => update({ timeFormat })}>{timeFormat === 'auto' ? 'Auto' : `${timeFormat}-hour`}</button>)}</div></section>
    <section><h2>Appearance</h2><p>System follows your device automatically.</p><div className="quick-choice">{(['system', 'light', 'dark'] as const).map(theme => <button key={theme} aria-label={`${theme} theme`} aria-pressed={settings.theme === theme} onClick={() => update({ theme })}>{theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></section>
    <section><h2>Providers</h2><p>Show, hide, and arrange your lineup.</p><div className="quick-provider-settings">{settings.providerOrder.map((id, index) => {
      const provider = catalog.find(provider => provider.id === id)!;
      return <div key={id}><label><input type="checkbox" checked={settings.enabled.includes(id)} onChange={() => update({ enabled: settings.enabled.includes(id) ? settings.enabled.filter(value => value !== id) : [...settings.enabled, id] })}/><span>{provider.name}</span></label><button aria-label={`Move ${provider.name} up`} disabled={index === 0} onClick={() => reorder(index, -1)}><Icon name="up" size={19}/></button><button aria-label={`Move ${provider.name} down`} disabled={index === settings.providerOrder.length - 1} onClick={() => reorder(index, 1)}><Icon name="down" size={19}/></button></div>;
    })}</div><button className="quick-text-button" onClick={connect}>Manage connections <Icon name="arrow" size={14}/></button><p className="quick-info">Antigravity and additional providers are not supported yet.</p></section>
    <ActivityTools settings={settings} providers={providers} update={update}/>
    <AlertSettings settings={settings} update={update}/>
    {DEMO_AVAILABLE && <section><h2>Demo preview</h2><label className="quick-check"><input type="checkbox" checked={settings.demo} onChange={() => update({ demo: !settings.demo })}/>Use sample data</label><p>Turn off to use your connected accounts.</p></section>}
  </div>;
}
