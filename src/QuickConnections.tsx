import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ProviderId, Settings } from './model';
import type { LiveResult } from './useLiveProviders';
import { Icon } from './icons';
import { Modal } from './Modal';
import { ProviderLogo } from './ProviderLogo';
import { AccountProfiles } from './AccountProfiles';
import { TokenConnection } from './TokenConnection';
import { KeychainAccess } from './KeychainAccess';
import { CLAUDE_LIVE, CLAUDE_LOCAL, CURSOR_UNOFFICIAL, plural, providerNames } from './format';
import { NotAffiliated, UnofficialBadge, UnofficialNote } from './ProviderNotes';
import { ClaudeUsageAccess } from './ClaudeUsageAccess';
import { hasClaudeUsageConsent } from './legal';
import { useProviderReorder } from './useProviderReorder';

const providerIds: ProviderId[] = ['claude', 'codex', 'cursor'];
const descriptions: Record<ProviderId, string> = { claude: 'Recorded token history from local Claude Code logs · no quotas', codex: 'Official CLI quotas & recorded activity', cursor: 'Monthly allowance' };
const connectIntro: Record<ProviderId, string> = { claude: 'Use the Claude Code profile on this device.', codex: 'Use the Codex CLI installed on this device.', cursor: 'Use your existing Cursor desktop sign-in on this device.' };
const connectDetail: Record<ProviderId, string> = {
  claude: `${CLAUDE_LOCAL} Claude quotas are not shown. Days older than Claude Code keeps its logs (30 days by default) are marked as not recorded.`,
  codex: 'MeterLuma asks the installed official Codex CLI app-server for your limits and reads recorded token counts from local Codex session logs. No token is copied into settings or sent to MeterLuma servers.',
  cursor: 'MeterLuma reads your existing Cursor sign-in in the native process and sends it only to Cursor to fetch your monthly allowance. No token is copied into settings or sent to MeterLuma servers. Cached quotas keep their original fetch time.',
};

export function QuickConnections({ settings, update, results, onTokenChange }: { settings: Settings; update: (value: Partial<Settings>) => boolean; results: LiveResult[]; onTokenChange: (id: ProviderId) => void }) {
  const [pending, setPending] = useState<ProviderId | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [error, setError] = useState('');
  const tokenProviders = settings.tokenProviders ?? [];
  const reorder = useProviderReorder(settings.providerOrder, ids => update({ providerOrder: ids as ProviderId[] }));
  async function disconnect(id: ProviderId) {
    setError('');
    try { if (tokenProviders.includes(id)) await invoke('forget_account_token', { providerId: id });
      update({ liveProviders: settings.liveProviders.filter(value => value !== id), ignoredLocalProviders: [...new Set([...(settings.ignoredLocalProviders ?? []), id])] }); onTokenChange(id);
    } catch { setError('The saved token could not be removed. Try disconnecting again.'); }
  }
  function connectionState(id: ProviderId) {
    if (settings.demo) return settings.enabled.includes(id) ? 'Sample data enabled' : 'Not connected';
    const tokenMode = tokenProviders.includes(id);
    const accounts = tokenMode ? 0 : settings.profiles.filter(profile => profile.providerId === id && !profile.paused).length;
    if (!settings.liveProviders.includes(id)) return accounts ? `${plural(accounts, 'local account')} connected` : 'Not connected';
    const result = results.find(row => row.key === (tokenMode ? `token-${id}` : id));
    if (id === 'claude' && !hasClaudeUsageConsent(settings)) return result?.provider?.history?.available ? 'Connected · local history' : result?.loading ? 'Reading local history…' : 'Local profile selected';
    if (result?.provider?.cached) return result.quotaFailure?.code === 'rate_limited' ? 'Rate limited (cached)' : 'Cached quotas';
    if (result?.provider?.fetchedAt) return tokenMode ? 'Connected with account token' : 'Connected';
    if (tokenMode) return result?.loading ? 'Reading subscription limits...' : result?.error ? 'Account token needs attention' : 'Account token selected';
    return result?.quotaFailure?.code === 'rate_limited' ? 'Local profile selected · rate limited' : 'Local profile selected';
  }
  async function connect(id: ProviderId) {
    if (isTauri() && tokenProviders.includes(id)) {
      try { await invoke('forget_account_token', { providerId: id }); } catch { setError('The saved token could not be removed. Try disconnecting again.'); return; }
    }
    // The browser preview cannot read local profiles, so it offers labeled sample data instead.
    if (isTauri()) update({ demo: false, liveProviders: [...new Set([...settings.liveProviders, id])], tokenProviders: tokenProviders.filter(value => value !== id), ignoredLocalProviders: (settings.ignoredLocalProviders ?? []).filter(value => value !== id), profiles: settings.profiles.map(row => row.providerId === id ? { ...row, paused: false } : row), enabled: [...new Set([...settings.enabled, id])] });
    else update({ demo: true });
    setPending(null);
  }
  return <div className="quick-connections">
    <p className="quick-info quick-connections-intro">{isTauri() ? 'Use existing local sign-ins. Refresh after signing in.' : 'Sample data preview. Live connections need the desktop app.'}</p>
    <ul className="quick-connection-list" ref={reorder.list} aria-label="Core providers">{settings.providerOrder.map(id => {
      const name = providerNames[id];
      const connected = settings.liveProviders.includes(id);
      return <li className="quick-connection" key={id} {...reorder.rowProps(id)}>
        <button className="provider-reorder-handle" {...reorder.handleProps(id, name)}><Icon name="drag" size={16}/></button>
        <span className="quick-connection-logo"><ProviderLogo id={id} size={id === 'codex' ? 56 : 28}/></span>
        <div className="quick-connection-copy">
          <div className="quick-connection-title"><h2>{name}</h2>{id === 'cursor' && <UnofficialBadge/>}</div>
          <span className="quick-connection-state">{connectionState(id)}</span>
        </div>
        <button className="quick-connection-action" aria-label={`${connected ? 'Disconnect' : 'Connect'} ${name}`} onClick={() => connected ? void disconnect(id) : setPending(id)}>{connected ? 'Disconnect' : 'Connect'}</button>
        {(id === 'claude' && isTauri() || connected && tokenProviders.includes(id)) && <div className="quick-connection-options">
          {id === 'claude' && isTauri() && <ClaudeUsageAccess settings={settings} update={update} onChange={() => onTokenChange('claude')}/>}
          {connected && tokenProviders.includes(id) && <button className="text-button" aria-label={`Replace ${name} token`} onClick={() => setPending(id)}>Replace token</button>}
          {connected && tokenProviders.includes(id) && <KeychainAccess connectionId={id} name={name} error={results.find(row => row.key === `token-${id}`)?.error} onUnlocked={() => onTokenChange(id)}/>}
        </div>}
      </li>;
    })}</ul>
    <span className="reorder-announcement" role="status">{reorder.announcement}</span>
    {error && <p className="quick-info" role="alert">{error}</p>}
    <AccountProfiles settings={settings} update={update}/>
    <details className="quick-connection-help"><summary>About connections</summary>
    <p className="quick-info">{isTauri() ? 'MeterLuma automatically finds local Claude Code history and existing Codex and Cursor connections on this computer. No separate login or pasted token is needed. After signing in to a provider app, use Refresh here.' : 'This browser preview uses sample data. Live connections run in the Mac and Windows desktop app.'}</p>
    <dl className="quick-connection-descriptions">{providerIds.map(id => <div key={id}><dt>{providerNames[id]}</dt><dd>{id === 'claude' && hasClaudeUsageConsent(settings) ? 'Session and weekly limits · recorded local history' : descriptions[id]}{id === 'cursor' && <p>{CURSOR_UNOFFICIAL}</p>}</dd></div>)}</dl>
    <p className="quick-info"><Icon name="check" size={13}/> {settings.demo ? 'Demo mode does not read provider credentials or make usage requests.' : `Existing sign-ins stay in their provider apps. Disconnecting here stops automatic detection for that provider without signing you out. ${hasClaudeUsageConsent(settings) ? 'Claude live usage uses your existing Claude Code login to contact Anthropic. Recorded history stays on this device.' : 'Claude reads local history only until you enable live usage.'}`}</p>
    <NotAffiliated className="quick-info"/>
    </details>
    {pending && <Modal dismissible={!tokenBusy} title={isTauri() ? `Connect ${providerNames[pending]}` : 'Connect in the desktop app.'} onClose={() => { if (!tokenBusy) setPending(null); }}>
      <p className="modal-intro">{isTauri() ? connectIntro[pending] : 'Live account connections need the MeterLuma desktop app. This browser preview does not access your local sign-ins.'}</p>
      <div className="notice compact"><Icon name="info"/><p>{isTauri() ? pending === 'claude' && hasClaudeUsageConsent(settings) ? CLAUDE_LIVE : connectDetail[pending] : 'You can explore the interface using labeled sample data. No provider tokens are requested here.'}</p></div>
      {isTauri() && pending === 'cursor' && <UnofficialNote className="modal-note"/>}
      <button className="button primary full-width" disabled={tokenBusy} onClick={() => connect(pending)}>{isTauri() ? 'Use local profile' : 'Explore sample data'} <Icon name="arrow" size={16}/></button>
      {isTauri() && pending !== 'claude' && <details className="license-details" open={tokenProviders.includes(pending) && settings.liveProviders.includes(pending)}><summary>Advanced: use an account token instead</summary><TokenConnection key={pending} providerId={pending} onBusy={setTokenBusy} onConnected={() => {
        update({ demo: false, liveProviders: [...new Set([...settings.liveProviders, pending])], tokenProviders: [...new Set([...tokenProviders, pending])], enabled: [...new Set([...settings.enabled, pending])] });
        onTokenChange(pending); setPending(null);
      }}/></details>}
    </Modal>}
  </div>;
}
