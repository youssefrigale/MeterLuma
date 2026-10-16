import { useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { ProviderId, Settings } from './model';
import type { LiveResult } from './useLiveProviders';
import { Icon } from './icons';
import { Modal } from './Modal';
import { ProviderLogo } from './ProviderLogo';
import { AccountProfiles } from './AccountProfiles';
import { CLAUDE_LOCAL, CURSOR_UNOFFICIAL, plural, providerNames } from './format';
import { NotAffiliated, UnofficialBadge, UnofficialNote } from './ProviderNotes';

const providerIds: ProviderId[] = ['claude', 'codex', 'cursor'];
const descriptions: Record<ProviderId, string> = { claude: 'Recorded token history from local Claude Code logs · no quotas', codex: 'Official CLI quotas & recorded activity', cursor: 'Monthly allowance' };
const connectIntro: Record<ProviderId, string> = { claude: 'Show recorded Claude Code token history from this device.', codex: 'Use the Codex CLI installed on this device.', cursor: 'Use your existing Cursor desktop sign-in on this device.' };
const connectDetail: Record<ProviderId, string> = {
  claude: `${CLAUDE_LOCAL} Claude quotas are not shown. Days older than Claude Code keeps its logs (30 days by default) are marked as not recorded.`,
  codex: 'MeterLuma asks the installed official Codex CLI app-server for your limits and reads recorded token counts from local Codex session logs. No token is copied into settings or sent to MeterLuma servers.',
  cursor: 'MeterLuma reads your existing Cursor sign-in in the native process and sends it only to Cursor to fetch your monthly allowance. No token is copied into settings or sent to MeterLuma servers. Cached quotas keep their original fetch time.',
};

export function QuickConnections({ settings, update, results }: { settings: Settings; update: (value: Partial<Settings>) => void; results: LiveResult[] }) {
  const [pending, setPending] = useState<ProviderId | null>(null);
  function connectionState(id: ProviderId) {
    if (settings.demo) return settings.enabled.includes(id) ? 'Sample data enabled' : 'Not connected';
    const accounts = settings.profiles.filter(profile => profile.providerId === id).length;
    if (!settings.liveProviders.includes(id)) return accounts ? `${plural(accounts, 'local account')} connected` : 'Not connected';
    const result = results.find(row => row.key === id);
    if (id === 'claude') return result?.provider?.history?.available ? 'Connected · local history' : result?.loading ? 'Reading local history…' : 'Local profile selected';
    if (result?.provider?.cached) return result.quotaFailure?.code === 'rate_limited' ? 'Rate limited (cached)' : 'Cached quotas';
    if (result?.provider?.fetchedAt) return 'Connected';
    return result?.quotaFailure?.code === 'rate_limited' ? 'Local profile selected · rate limited' : 'Local profile selected';
  }
  function connect(id: ProviderId) {
    // The browser preview cannot read local profiles, so it offers labeled sample data instead.
    if (isTauri()) update({ demo: false, liveProviders: [...new Set([...settings.liveProviders, id])], enabled: [...new Set([...settings.enabled, id])] });
    else update({ demo: true });
    setPending(null);
  }
  return <div className="quick-connections">
    <p className="quick-info">{isTauri() ? 'Codex quotas come from its official CLI. Cursor uses your local Cursor sign-in with an unofficial endpoint. Claude is read only from local Claude Code logs, without its sign-in.' : 'This browser preview uses sample data. Live connections run in the Mac and Windows desktop app.'}</p>
    <ul className="quick-connection-list">{providerIds.map(id => {
      const name = providerNames[id];
      const connected = settings.liveProviders.includes(id);
      return <li className="quick-connection" key={id}>
        <span className="quick-connection-logo"><ProviderLogo id={id} size={20}/></span>
        <div className="quick-connection-copy">
          <div className="quick-connection-title"><h2>{name}</h2>{id === 'cursor' && <UnofficialBadge/>}</div>
          <p>{descriptions[id]}</p>
          {id === 'cursor' && <p className="quick-connection-unofficial">{CURSOR_UNOFFICIAL}</p>}
          <span className="quick-connection-state">{connectionState(id)}</span>
        </div>
        <button className="quick-connection-action" aria-label={`${connected ? 'Disconnect' : 'Connect'} ${name}`} onClick={() => connected ? update({ liveProviders: settings.liveProviders.filter(value => value !== id) }) : setPending(id)}>{connected ? 'Disconnect' : 'Connect'}</button>
      </li>;
    })}</ul>
    <AccountProfiles settings={settings} update={update}/>
    <p className="quick-info"><Icon name="check" size={13}/> {settings.demo ? 'Demo mode does not read provider credentials or make usage requests.' : "Cursor's sign-in stays in the native process and is sent only to Cursor. Codex uses its official CLI. Claude is read from local logs only; MeterLuma never reads the Claude sign-in or contacts Anthropic. Tokens are never copied into settings."}</p>
    <NotAffiliated className="quick-info"/>
    {pending && <Modal title={isTauri() ? `Connect ${providerNames[pending]}` : 'Connect in the desktop app.'} onClose={() => setPending(null)}>
      <p className="modal-intro">{isTauri() ? connectIntro[pending] : 'Live account connections need the MeterLuma desktop app. This browser preview does not access your local sign-ins.'}</p>
      <div className="notice compact"><Icon name="info"/><p>{isTauri() ? connectDetail[pending] : 'You can explore the interface using labeled sample data. No provider tokens are requested here.'}</p></div>
      {isTauri() && pending === 'cursor' && <UnofficialNote className="modal-note"/>}
      <button className="button primary full-width" onClick={() => connect(pending)}>{isTauri() ? 'Use local profile' : 'Explore sample data'} <Icon name="arrow" size={16}/></button>
    </Modal>}
  </div>;
}
