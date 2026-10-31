import { useState } from 'react';
import type { Settings } from './model';
import type { LiveResult } from './useLiveProviders';
import type { AdditionalResult } from './additional/model';
import { diagnosticReport } from './diagnosticReport';
import { clearLookupDiagnostics } from './lookupDiagnostics';
import { saveDocument } from './saveDocument';

export function DiagnosticTools({ settings, core, additional }: { settings: Settings; core: LiveResult[]; additional: AdditionalResult[] }) {
  const capture = () => diagnosticReport(settings, core, additional);
  const [report, setReport] = useState(capture);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  async function save() {
    setSaving(true); setStatus('');
    try { setStatus(await saveDocument('diagnostics', JSON.stringify(report, null, 2)) ? 'Diagnostics saved locally. Nothing was sent.' : 'Export cancelled.'); }
    catch { setStatus('Diagnostics could not be saved. Try exporting again.'); }
    finally { setSaving(false); }
  }
  return <div className="diagnostic-tools"><h3>Diagnostics</h3><p>Check provider status and recent lookup timing. This report excludes credentials, account labels, local paths and usage values. It is saved locally and is never sent automatically.</p>
    <details><summary>Preview diagnostics</summary><pre className="diagnostic-preview">{JSON.stringify(report, null, 2)}</pre></details>
    <div className="activity-tools"><button className="button" disabled={saving} onClick={() => void save()}>Export diagnostics</button><button className="button" disabled={saving} onClick={() => { setReport(capture()); setStatus('Diagnostic snapshot updated.'); }}>Refresh diagnostics</button></div>
    <button disabled={saving} onClick={() => { clearLookupDiagnostics(); setReport(capture()); setStatus('Recent diagnostic timing cleared from memory.'); }}>Clear diagnostic history</button>
    {status && <p role="status">{status}</p>}
  </div>;
}
