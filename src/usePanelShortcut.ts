import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export function usePanelShortcut(saved: string | undefined, remember: (shortcut: string | undefined) => boolean) {
  const rememberLatest = useRef(remember);
  const restored = useRef(false);
  rememberLatest.current = remember;
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(isTauri() && !!saved);
  const [error, setError] = useState('');
  async function activate(shortcut: string | null) {
    setBusy(true); setError('');
    try {
      const registered = await invoke<string | null>('set_panel_shortcut', { shortcut });
      setActive(registered); return registered;
    }
    finally { setBusy(false); }
  }
  function reportFailure(reason: unknown) { setError(typeof reason === 'string' ? reason : 'The shortcut could not be changed. Try again.'); }
  async function apply(shortcut: string | null) {
    try {
      const registered = await activate(shortcut);
      if (!rememberLatest.current(registered ?? undefined)) setError('The shortcut changed for this session, but could not be saved for next time.');
    } catch (reason) { reportFailure(reason); }
  }
  // Restore once per WebView session; display preference imports never register keyboard bindings.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (isTauri() && saved) void activate(saved).catch(reportFailure);
  }, []);
  return { active, busy, error, apply };
}
