import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Modal } from './Modal';

export const keychainLocked = (error?: string) => error?.startsWith('Saved connection is locked.') ?? false;

export function KeychainAccess({ connectionId, name, error, onUnlocked, label = 'Unlock saved connection' }: { connectionId: string; name: string; error?: string; onUnlocked: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  async function unlock() {
    setBusy(true); setFailure('');
    try {
      await invoke('unlock_saved_connection', { connectionId });
      setOpen(false); onUnlocked();
    } catch { setFailure('Keychain access was not granted. Your saved connection is unchanged.'); }
    finally { setBusy(false); }
  }
  if (!keychainLocked(error)) return null;
  return <>
    <button className="text-button" aria-label={`Unlock ${name} saved connection`} onClick={() => { setFailure(''); setOpen(true); }}>{label}</button>
    {open && <Modal title={`Unlock ${name} connection`} dismissible={!busy} onClose={() => setOpen(false)}>
      <p className="modal-intro">macOS needs your permission to read the {name} credential saved by MeterLuma.</p>
      <p className="quick-info">Continue to the macOS Keychain dialog. Your Mac password stays with macOS. Automatic refresh waits quietly when access is locked.</p>
      <p className="quick-info">If macOS offers Always Allow, that lets this app read the saved credential during future refreshes. Allow grants a single read.</p>
      {failure && <p className="quick-info" role="alert">{failure}</p>}
      <button className="button primary full-width" disabled={busy} onClick={() => void unlock()}>{busy ? 'Waiting for Keychain…' : 'Continue to Keychain'}</button>
    </Modal>}
  </>;
}
