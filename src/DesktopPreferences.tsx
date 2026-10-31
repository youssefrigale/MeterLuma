import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export function DesktopPreferences() {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  async function read() {
    setBusy(true); setStatus('');
    try { setEnabled(await invoke<boolean>('startup_enabled')); }
    catch { setEnabled(undefined); setStatus('The system login setting is unavailable. Try checking again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (isTauri()) void read(); else setBusy(false); }, []);
  async function toggle() {
    if (enabled === undefined || busy) return;
    setBusy(true); setStatus('');
    try {
      const actual = await invoke<boolean>('set_startup_enabled', { enabled: !enabled });
      setEnabled(actual); setStatus(actual === !enabled ? actual ? 'MeterLuma will start when you log in.' : 'Start at login turned off.' : 'The system did not confirm the requested login setting.');
    } catch {
      try { setEnabled(await invoke<boolean>('startup_enabled')); } catch { setEnabled(undefined); }
      setStatus('The system login setting could not be changed. Check permissions and try again.');
    } finally { setBusy(false); }
  }
  return <section><h2>Start at login</h2><label className="quick-check"><input type="checkbox" checked={enabled === true} disabled={!isTauri() || busy || enabled === undefined} onChange={() => void toggle()}/>Open MeterLuma when you log in</label><p>Enabled by default. Starts quietly in the menu bar. You can turn it off here; this computer's setting is excluded from preference imports.</p>
    {status && <p role="status">{status}</p>}{isTauri() && enabled === undefined && !busy && <button className="quick-text-button" onClick={() => void read()}>Check login setting again</button>}
  </section>;
}
