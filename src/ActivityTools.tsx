import { useState } from 'react';
import type { HistoryDays, Provider, Settings } from './model';
import { downloadUsage } from './exportUsage';
import { Icon } from './icons';

export function ActivityTools({ settings, providers, update }: { settings: Settings; providers: Provider[]; update: (value: Partial<Settings>) => void }) {
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(format: 'csv' | 'json') {
    setSaving(true); setStatus('');
    try { const saved = await downloadUsage(providers, settings.demo, format); setStatus(saved === false ? 'Export cancelled.' : 'Export created. Keep it private if it contains personal information.'); }
    catch { setStatus('Export could not be saved. Please try again.'); }
    finally { setSaving(false); }
  }
  return <section className="panel feature-panel"><h2>History and exports</h2><div className="activity-tools"><label>Recorded history window<select value={settings.historyDays} onChange={event => update({ historyDays: Number(event.target.value) as HistoryDays })}>{[30, 90, 365].map(days => <option key={days} value={days}>{days} days</option>)}</select></label><button className="button" disabled={saving || !providers.some(provider => provider.history?.available)} onClick={() => void save('csv')}><Icon name="download" size={16}/>Export CSV</button><button className="button" disabled={saving || !providers.length} onClick={() => void save('json')}><Icon name="download" size={16}/>Export JSON</button></div><p>All features are free for personal use. History uses recorded local logs; demo charts stay at their labeled sample range. CSV contains daily token activity. JSON also includes available quota snapshots. Exports include profile labels, but no credentials or local paths.</p>{status && <p role="status">{status}</p>}</section>;
}
