import { useState } from 'react';
import { defaults, type Settings } from './model';

type OverviewLayout = Pick<Settings, 'expandedCards' | 'providerOrder' | 'additionalProviderOrder' | 'trayMetric'>;

export function OverviewLayoutSettings({ settings, update }: { settings: Settings; update: (layout: Partial<Settings>) => boolean }) {
  const [previous, setPrevious] = useState<OverviewLayout>();
  const [status, setStatus] = useState('');
  const changed = !!settings.additionalProviderOrder?.length || !!settings.expandedCards?.length || settings.providerOrder.join(',') !== defaults.providerOrder.join(',') || (settings.trayMetric ?? 'session') !== 'session';
  function restore() {
    setStatus('');
    const before = { expandedCards: [...settings.expandedCards ?? []], providerOrder: [...settings.providerOrder], additionalProviderOrder: [...settings.additionalProviderOrder ?? []], trayMetric: settings.trayMetric };
    if (update({ expandedCards: [], providerOrder: [...defaults.providerOrder], additionalProviderOrder: [], trayMetric: 'session' })) {
      setPrevious(before); setStatus('Overview cards collapsed, provider order and menu bar allowance restored.');
    }
  }
  function undo() {
    setStatus('');
    if (previous && update(previous)) { setPrevious(undefined); setStatus('Previous overview layout restored.'); }
  }
  return <section><h2>Overview layout</h2><p>Overview cards start collapsed. Click a provider heading to expand or collapse its card. Meters, amounts and warnings stay visible; detail pages keep their full layout.</p><button className="quick-text-button" disabled={!changed} onClick={restore}>Restore overview layout</button><p>Collapses cards and resets provider order and the menu bar allowance. Keeps theme, visibility, spacing, refresh, alerts, notifications and connections.</p>{status && <p role="status">{status}</p>}{previous && <button className="quick-text-button" onClick={undo}>Undo overview layout reset</button>}</section>;
}
