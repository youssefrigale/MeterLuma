import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export function PinnedPanelSettings() {
  const [pinned, setPinned] = useState<boolean>();
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  async function read() {
    setBusy(true); setStatus('');
    try { setPinned(await invoke<boolean>('panel_pinned')); }
    catch { setStatus('The panel setting is unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (isTauri()) void read(); else setBusy(false); }, []);
  async function toggle() {
    if (busy || pinned === undefined) return;
    setBusy(true); setStatus('');
    try { setPinned(await invoke<boolean>('set_panel_pinned', { pinned: !pinned })); }
    catch {
      try { setPinned(await invoke<boolean>('panel_pinned')); } catch { setPinned(undefined); }
      setStatus('The panel setting could not be changed. Try again.');
    }
    finally { setBusy(false); }
  }
  return <section><h2>Keep panel open</h2><label className="quick-check"><input type="checkbox" checked={pinned === true} disabled={!isTauri() || busy || pinned === undefined} onChange={() => void toggle()}/>Keep usage visible above other apps</label><p>The panel stays open when focus moves to another app. Click the menu bar icon to hide it. Turns off when MeterLuma quits.</p>{status && <p role="status">{status}</p>}{isTauri() && pinned === undefined && !busy && <button className="quick-text-button" onClick={() => void read()}>Check panel setting again</button>}</section>;
}
