import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ProviderId, Settings } from './model';
import { providerNames } from './format';

export function AccountProfiles({ settings, update }: { settings: Settings; update: (value: Partial<Settings>) => void }) {
  const [providerId, setProviderId] = useState<ProviderId>('codex');
  const [label, setLabel] = useState('');
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <section className="panel feature-panel"><h2>Multiple local accounts</h2><p>Connect separate, existing local profiles for your own accounts. Each profile needs its own directory under your home folder. No tokens are copied. Labels do not prove which account created a log; history includes all sign-ins recorded in that directory.</p>
    <p>Codex: the CODEX_HOME folder containing auth.json or sessions. Claude: the CLAUDE_CONFIG_DIR folder containing projects; MeterLuma reads only the recorded token counts there, never the Claude sign-in. Cursor: the app-data folder containing User/globalStorage/state.vscdb.</p>
    <form className="feature-form" onSubmit={async event => {
      event.preventDefault(); setError('');
      if (!isTauri()) { setError('Add local accounts in the desktop app. Browser preview cannot read local profiles.'); return; }
      if (settings.profiles.length >= 12) return;
      setSaving(true);
      try {
        const canonical = await invoke<string>('validate_profile', { providerId, directory });
        if (settings.profiles.some(row => row.providerId === providerId && row.directory === canonical)) throw 'This local profile is already connected.';
        const tokenMode = settings.tokenProviders?.includes(providerId);
        if (tokenMode) await invoke('forget_account_token', { providerId });
        update({ ...(tokenMode ? { tokenProviders: settings.tokenProviders?.filter(id => id !== providerId), liveProviders: settings.liveProviders.filter(id => id !== providerId) } : {}), profiles: [...settings.profiles, { key: crypto.randomUUID(), providerId, label: label.trim(), directory: canonical }], demo: false, enabled: [...new Set([...settings.enabled, providerId])] });
        setLabel(''); setDirectory('');
      } catch (reason) { setError(typeof reason === 'string' ? reason : 'This local profile could not be connected.'); }
      finally { setSaving(false); }
    }}>
      <label>Provider<select value={providerId} onChange={event => setProviderId(event.target.value as ProviderId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="cursor">Cursor</option></select></label>
      <label>Account label<input maxLength={60} required value={label} onChange={event => setLabel(event.target.value)} placeholder="Personal account"/></label>
      <label className="profile-directory">Local profile directory<input maxLength={1024} required value={directory} onChange={event => setDirectory(event.target.value)} placeholder="Absolute path to your local profile" autoComplete="off" spellCheck={false}/></label>
      <button className="button" disabled={saving || settings.profiles.length >= 12 || !label.trim()}>{saving ? 'Checking profile…' : 'Add local account'}</button>
    </form>
    {error && <p role="status">{error}</p>}
    <ul className="feature-rows">{settings.profiles.map(profile => <li key={profile.key}><span>{profile.label} · {providerNames[profile.providerId]}{profile.paused ? ' (paused)' : settings.tokenProviders?.includes(profile.providerId) ? ' (paused for token connection)' : ''}</span><button className="text-button" aria-label={`Remove ${profile.label}`} onClick={() => update({ profiles: settings.profiles.filter(row => row.key !== profile.key) })}>Remove</button></li>)}</ul>
  </section>;
}
