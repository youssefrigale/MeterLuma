import { useMemo, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Modal } from './Modal';
import { LEGAL_VERSION } from './legal';
import type { Settings } from './model';
import licenseText from '../LICENSE?raw';
import privacyText from '../PRIVACY.md?raw';
import noticesUrl from '../THIRD_PARTY_NOTICES.txt?url';

// The notices file is several megabytes; render it in pages so the panel stays responsive.
export const NOTICE_PAGE = 200_000;
export function noticePages(text: string, size = NOTICE_PAGE) {
  const pages: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) { const line = text.lastIndexOf('\n', end); if (line > start) end = line + 1; }
    pages.push(text.slice(start, end)); start = end;
  }
  return pages;
}
const kilobytes = (value: number) => `${Math.ceil(value / 1000).toLocaleString()} KB`;

function Notices() {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(1);
  const pages = useMemo(() => text === null ? [] : noticePages(text), [text]);
  const visible = pages.slice(0, shown);
  const loaded = visible.reduce((sum, page) => sum + page.length, 0);
  return <details className="license-details" onToggle={event => {
    if (!event.currentTarget.open || text !== null) return;
    setFailed(false);
    void fetch(noticesUrl).then(response => { if (!response.ok) throw new Error(); return response.text(); }).then(setText).catch(() => setFailed(true));
  }}><summary>Third-party licenses and source links</summary>
    {failed ? <pre>Notices could not be loaded. See THIRD_PARTY_NOTICES.txt supplied with the application.</pre> : text === null ? <pre>Loading notices…</pre> : <>
      <div className="notices-viewer" role="region" tabIndex={0} aria-label="Third-party notices">{visible.map((page, index) => <pre key={index}>{page}</pre>)}</div>
      <div className="notices-more"><span role="status">Showing {kilobytes(loaded)} of {kilobytes(text.length)}</span>{shown < pages.length && <button className="button" onClick={() => setShown(value => value + 1)}>Show more</button>}</div>
    </>}
  </details>;
}

export function LegalMaterials() {
  return <><details className="license-details"><summary>Read the full license</summary><pre>{licenseText}</pre></details><details className="license-details"><summary>Privacy and local data</summary><pre>{privacyText}</pre></details><Notices/></>;
}

export function LicenseGate({ settings, update }: { settings: Settings; update: (value: Partial<Settings>) => void }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  if (!isTauri() || settings.legalVersion === LEGAL_VERSION) return null;
  return <Modal title="Before you connect" onClose={() => {}} dismissible={false}>
    <p className="modal-intro">MeterLuma is free for personal, noncommercial use only. Selling and redistribution are prohibited. Read the license and privacy information before connecting account tokens or local data.</p>
    <LegalMaterials/>
    <label className="legal-agreement"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)}/>I agree to the personal-use license and have read the privacy information.</label>
    <div className="legal-buttons"><button className="button primary" disabled={!agreed} onClick={() => update({ legalVersion: LEGAL_VERSION })}>Agree and continue</button><button className="button" onClick={() => void invoke('quit_app').catch(() => setError('Quit MeterLuma using the tray menu.'))}>Quit</button></div>
    {error && <p role="status">{error}</p>}
  </Modal>;
}
