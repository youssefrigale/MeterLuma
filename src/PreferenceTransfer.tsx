import { useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings } from './model';
import { displayPreferences, parsePreferenceFile, preferenceChanges, preferenceFile, preferenceNames, type DisplayPreferences } from './preferenceFile';
import { saveDocument } from './saveDocument';
import { Modal } from './Modal';

export function PreferenceTransfer({ settings, update }: { settings: Settings; update: (preferences: Partial<Settings>) => void }) {
  const [pending, setPending] = useState<DisplayPreferences>();
  const [undo, setUndo] = useState<DisplayPreferences>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  async function save() {
    setBusy(true); setStatus('');
    try { setStatus(await saveDocument('preferences', preferenceFile(settings)) ? 'Preferences exported.' : 'Export cancelled.'); }
    catch { setStatus('Preferences could not be saved. Try exporting again.'); }
    finally { setBusy(false); }
  }
  async function read(readText: () => Promise<string | null>) {
    setBusy(true); setStatus(''); setPending(undefined);
    try { const text = await readText(); if (text === null) setStatus('Import cancelled.'); else setPending(parsePreferenceFile(text)); }
    catch { setStatus('Choose a valid MeterLuma preferences JSON file, up to 64 KiB. No settings were changed.'); }
    finally { setBusy(false); }
  }
  function importFile(file?: File) {
    if (!file) return;
    void read(async () => { if (file.size > 65_536) throw new Error('Oversized file.'); return file.text(); });
  }
  function apply() {
    if (!pending) return;
    setUndo(displayPreferences(settings)); update(pending); setPending(undefined); setStatus('Imported display preferences. Connections, alerts and consent were kept.');
  }
  const changes = pending ? preferenceChanges(settings, pending) : [];
  return <section className="panel feature-panel"><h2>Settings backup</h2><p>Export or restore display preferences, including provider visibility and order. Connections, local accounts, alerts and consent stay on this device.</p>
    <div className="activity-tools"><button className="button" disabled={busy} onClick={() => void save()}>Export preferences</button><button className="button" disabled={busy} onClick={() => isTauri() ? void read(() => invoke<string | null>('open_preferences_import')) : fileInput.current?.click()}>Import preferences</button></div>
    {!isTauri() && <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Preferences file" onChange={event => { importFile(event.target.files?.[0]); event.target.value = ''; }}/>} 
    {status && <p role="status">{status}</p>}
    {undo && <button className="quick-text-button" onClick={() => { update(undo); setUndo(undefined); setStatus('Previous display preferences restored.'); }}>Undo preference import</button>}
    {pending && <Modal title="Import display preferences?" onClose={() => setPending(undefined)}><p className="modal-intro">{changes.length ? 'These settings will change:' : 'This file matches your current display preferences.'}</p>{changes.length > 0 && <ul className="preference-changes">{changes.map(field => <li key={field}>{preferenceNames[field]}</li>)}</ul>}<p className="quick-info">Your connections, local accounts, alerts and privacy choices are kept. No provider is connected by this import.</p><div className="dialog-actions legal-buttons"><button className="button primary" onClick={apply} disabled={!changes.length}>Apply preferences</button><button className="button" onClick={() => setPending(undefined)}>Cancel</button></div></Modal>}
  </section>;
}
