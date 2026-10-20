import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ProviderId } from './model';
import { providerNames } from './format';

export function TokenConnection({ providerId, onConnected, onBusy }: { providerId: Exclude<ProviderId, 'claude'>; onConnected: () => void; onBusy: (busy: boolean) => void }) {
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="feature-form token-connection" onSubmit={async event => {
    event.preventDefault();
    if (busy || !token.trim()) return;
    const submitted = token;
    setToken(''); setError(''); setBusy(true); onBusy(true);
    try {
      await invoke('connect_account_token', { providerId, token: submitted, accountId: accountId.trim() || null });
      onConnected();
    } catch (reason) {
      const message = typeof reason === 'string' ? reason : typeof reason === 'object' && reason && 'message' in reason && typeof reason.message === 'string' ? reason.message : 'The token could not be connected. Try again.';
      setError(message);
    } finally { setBusy(false); onBusy(false); }
  }}>
    <p className="quick-info">Fetch {providerNames[providerId]} subscription limits with your account access token. This connection does not read local logs or provider sign-in files. Existing local profiles for this provider are paused.</p>
    <label className="profile-directory">Account access token<input type="password" value={token} onChange={event => setToken(event.target.value)} required maxLength={16384} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
    {providerId === 'codex' && <label className="profile-directory">ChatGPT account ID (optional)<input value={accountId} onChange={event => setAccountId(event.target.value)} maxLength={256} autoComplete="off" spellCheck={false} placeholder="Detected from the access token when available" disabled={busy}/></label>}
    <p className="quick-info">{providerId === 'codex' ? 'Use a ChatGPT OAuth access token. The official Codex CLI must be installed; it runs in a separate temporary profile with your supplied token.' : 'Use a Cursor access token. The monthly-allowance endpoint is unofficial and can change.'} API keys, refresh tokens and browser cookies are not supported. Replace the access token here when it expires.</p>
    <p className="quick-info">Saved with Windows account encryption or macOS Keychain. The token is never saved in preferences, logs or exports. Disconnecting removes the saved token.</p>
    {error && <p role="alert" className="quick-info">{error}</p>}
    <button className="button primary full-width" disabled={busy || !token.trim()}>{busy ? 'Checking token…' : 'Connect with token'}</button>
  </form>;
}
