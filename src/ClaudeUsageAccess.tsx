import { useState } from 'react';
import type { Settings } from './model';
import { LEGAL_VERSION, hasClaudeUsageConsent } from './legal';
import { Modal } from './Modal';
import { CLAUDE_LIVE } from './format';

export function ClaudeUsageAccess({ settings, update, onChange }: { settings: Settings; update: (settings: Partial<Settings>) => void; onChange: () => void }) {
  const [notice, setNotice] = useState(false);
  const enabled = hasClaudeUsageConsent(settings);
  function enable() {
    const selected = settings.liveProviders.includes('claude') || settings.profiles.some(profile => profile.providerId === 'claude' && !profile.paused);
    update({ legalVersion: LEGAL_VERSION, claudeLive: true, liveProviders: selected ? settings.liveProviders : [...settings.liveProviders, 'claude'], enabled: [...new Set([...settings.enabled, 'claude' as const])], ignoredLocalProviders: (settings.ignoredLocalProviders ?? []).filter(id => id !== 'claude') });
    onChange(); setNotice(false);
  }
  return <>
    <button className="text-button" onClick={() => { if (enabled) { update({ claudeLive: false }); onChange(); } else setNotice(true); }}>{enabled ? 'Use history only' : 'Enable live Claude usage'}</button>
    {notice && <Modal title="Enable live Claude usage" onClose={() => setNotice(false)}>
      <p className="modal-intro">Read session and weekly limits using your existing Claude Code sign-in.</p>
      <p className="modal-note">{CLAUDE_LIVE}</p>
      <p className="modal-note">The usage endpoint may change. Plan labels come from the saved login and do not establish billing status. Local history stays available if live limits cannot be read.</p>
      <button className="button primary full-width" onClick={enable}>Enable live usage</button>
    </Modal>}
  </>;
}
