import { useState } from 'react';
import type { HistoryDays, Provider, Settings } from './model';
import { downloadUsage } from './exportUsage';
import { Icon } from './icons';

export function ActivityTools({ settings, providers, update }: { settings: Settings; providers: Provider[]; update: (value: Partial<Settings>) => void }) {
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const csvReady = providers.some(provider => provider.history?.available);
  async function save(format: 'csv' | 'json') {
    setSaving(true); setStatus('');
    try { const saved = await downloadUsage(providers, settings.demo, format); setStatus(saved === false ? 'Export cancelled.' : 'Export created. Keep it private if it contains personal information.'); }
    catch { setStatus('Export could not be saved. Please try again.'); }
    finally { setSaving(false); }
  }
  return <section className="panel feature-panel"><h2>History and exports</h2><div className="activity-tools"><label>Recorded history window<select value={settings.historyDays} onChange={event => update({ historyDays: Number(event.target.value) as HistoryDays })}>{[30, 90, 365].map(days => <option key={days} value={days}>{days} days</option>)}</select></label><button className="button" disabled={saving || !csvReady} aria-describedby={csvReady ? undefined : 'csv-unavailable'} onClick={() => void save('csv')}><Icon name="download" size={16}/>Export CSV</button><button className="button" disabled={saving || !providers.length} onClick={() => void save('json')}><Icon name="download" size={16}/>Export JSON</button></div>
    {!csvReady && <p id="csv-unavailable">CSV export needs recorded token history from Claude Code or Codex.{providers.some(provider => provider.id === 'cursor') ? ' Cursor token history is not recorded locally, so Cursor appears only in the JSON export with its monthly allowance.' : ''}</p>}
    <p>All features are free for personal use. History uses recorded local logs; days without logs are marked as not recorded rather than zero. CSV contains daily token activity with a recorded column. JSON also includes coverage dates and available quota snapshots. Exports include profile labels, but no credentials or local paths.</p>{status && <p role="status">{status}</p>}</section>;
}
