import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Modal } from './Modal';
import { LEGAL_VERSION } from './legal';
import type { Settings } from './model';
import licenseText from '../LICENSE?raw';
import privacyText from '../PRIVACY.md?raw';
import noticesUrl from '../THIRD_PARTY_NOTICES.txt?url';

export function LegalMaterials() {
  const [notices, setNotices] = useState('');
  return <><details className="license-details"><summary>Read the full license</summary><pre>{licenseText}</pre></details><details className="license-details"><summary>Privacy and local data</summary><pre>{privacyText}</pre></details><details className="license-details" onToggle={event => { if (event.currentTarget.open && !notices) void fetch(noticesUrl).then(response => { if (!response.ok) throw new Error(); return response.text(); }).then(setNotices).catch(() => setNotices('Notices could not be loaded. See THIRD_PARTY_NOTICES.txt supplied with the application.')); }}><summary>Third-party licenses and source links</summary><pre>{notices || 'Loading notices…'}</pre></details></>;
}

export function LicenseGate({ settings, update }: { settings: Settings; update: (value: Partial<Settings>) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  if (!isTauri() || settings.legalVersion === LEGAL_VERSION) return null;
  return <Modal title="Before you connect" onClose={() => {}} dismissible={false}>
    <p className="modal-intro">MeterLuma is free for personal, noncommercial use only. Selling and redistribution are prohibited. Read the license and privacy information before connecting local data.</p>
    <LegalMaterials/>
    <label className="legal-agreement"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)}/>I agree to the personal-use license and have read the privacy information.</label>
    <div className="legal-buttons"><button className="button primary" disabled={!agreed} onClick={() => update({ legalVersion: LEGAL_VERSION })}>Agree and continue</button><button className="button" onClick={() => void invoke('quit_app').catch(() => setError('Quit MeterLuma using the tray menu.'))}>Quit</button></div>
    {error && <p role="status">{error}</p>}
  </Modal>;
}
