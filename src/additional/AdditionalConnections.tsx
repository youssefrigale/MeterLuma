import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings } from '../model';
import { Modal } from '../Modal';
import { Icon } from '../icons';
import { hasProviderConsent } from '../legal';
import { additionalCatalog, type AdditionalResult } from './model';
import { AdditionalLogo } from './AdditionalLogo';
import { snapshotFromNative } from './useAdditionalProviders';
import { orderedAdditional } from '../providerOrder';
import { useProviderReorder } from '../useProviderReorder';
import { KeychainAccess } from '../KeychainAccess';

export function AdditionalConnections({ settings, update, results, refresh }: { settings: Settings; update: (update: Partial<Settings>) => boolean; results: AdditionalResult[]; refresh: () => void }) {
  const [selected, setSelected] = useState<string | null>(null); const [token, setToken] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [label, setLabel] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const providers = orderedAdditional(additionalCatalog.filter(provider => provider.state === 'ready' || settings.additionalConnections?.some(connection => connection.id === provider.id)), settings.additionalProviderOrder);
  const reorder = useProviderReorder(providers.map(provider => provider.id), additionalProviderOrder => update({ additionalProviderOrder }));
  const websiteOnly = additionalCatalog.filter(provider => provider.state !== 'ready');
  const spec = providers.find(provider => provider.id === selected);
  function choose(id: string) {
    const provider = providers.find(provider => provider.id === id)!;
    setSelected(id); setToken(''); setIdentifier(''); setLabel(settings.additionalConnections?.find(connection => connection.id === id)?.label ?? provider.name); setAcknowledged(false); setError('');
  }
  async function disconnect(id: string) {
    if (removing) return;
    setRemoving(id); setError('');
    try { await invoke('forget_additional_provider', { providerId: id }); update({ additionalConnections: settings.additionalConnections?.filter(connection => connection.id !== id) }); refresh(); }
    catch { setError('The provider credential could not be removed. Try disconnecting again.'); }
    finally { setRemoving(null); }
  }
  async function dashboard(id: string) {
    try { await invoke('open_provider_page', { providerId: id, page: 'usage' }); }
    catch { setError('The provider dashboard could not be opened.'); }
  }
  async function connect(event: React.FormEvent) {
    event.preventDefault(); if (!spec || !acknowledged || !hasProviderConsent(settings)) return;
    setBusy(true); setError(''); const credential = spec.credentialScope ? JSON.stringify({ accessToken: token, [spec.credentialScope.field]: identifier.trim() }) : token; setToken(''); setIdentifier('');
    try {
      // The modal waits for secure storage; a UI timeout cannot cancel a native key replacement.
      const raw = await invoke<unknown>('connect_additional_provider', { providerId: spec.id, token: credential }); snapshotFromNative(raw, spec.id);
      update({ demo: false, additionalConnections: [...(settings.additionalConnections ?? []).filter(connection => connection.id !== spec.id), { id: spec.id, label: label.trim().replace(/[\x00-\x1f\x7f]/g, '') || spec.name, consentVersion: 1, enabled: true }] });
      refresh(); setSelected(null);
    } catch (reason) { setError(reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' ? reason.message : typeof reason === 'string' ? reason : 'This provider could not be connected.'); }
    finally { setBusy(false); }
  }
  return <section className="additional-connections"><details className="license-details"><summary>More providers</summary><p className="quick-info">Connect a provider individually. Each key is kept in native secure storage and sent only to that provider’s listed usage endpoints.</p>
    <span className="reorder-announcement" role="status">{reorder.announcement}</span>
    <ul className="provider-picker-list" aria-label="Additional providers" ref={reorder.list}>{providers.map(provider => {
      const connected = !!settings.additionalConnections?.some(connection => connection.id === provider.id);
      const result = results.find(result => result.id === provider.id);
      const status = connected && (result?.loading ? 'Reading usage…' : result?.error ? 'Needs attention' : '');
      return <li className="provider-picker-row" data-connected={connected} key={provider.id} {...reorder.rowProps(provider.id)}>
        <button className="provider-reorder-handle" {...reorder.handleProps(provider.id, provider.name)}><Icon name="drag" size={16}/></button>
        <AdditionalLogo id={provider.id}/>
        <div className="provider-picker-copy"><h3>{provider.name}</h3>{status && <span className="provider-picker-status" role="status">{status}</span>}{connected && <KeychainAccess connectionId={`external-${provider.id}`} name={provider.name} error={result?.error} onUnlocked={refresh}/>}</div>
        {connected && provider.state === 'ready' && provider.source === 'api' && <button className="provider-picker-manage" disabled={!isTauri() || removing !== null} aria-label={`Replace ${provider.name} key`} title="Replace key" onClick={() => choose(provider.id)}><Icon name="settings" size={15}/></button>}
        <button className="provider-picker-toggle" aria-pressed={connected} aria-busy={removing === provider.id} disabled={!isTauri() || removing !== null} aria-label={`${connected ? 'Disconnect' : 'Connect'} ${provider.name}`} title={removing === provider.id ? 'Disconnecting…' : connected ? `Disconnect ${provider.name}` : `Connect ${provider.name}`} onClick={() => connected ? void disconnect(provider.id) : choose(provider.id)}>{connected && <Icon name="check" size={15}/>}</button>
      </li>;
    })}</ul>{websiteOnly.length > 0 && <details className="license-details"><summary>Other requested providers</summary><p className="quick-info">Tracking is unavailable for these providers. You can open their account page; no credential is collected and no quota is invented.</p><ul className="provider-picker-list" aria-label="Providers without usage tracking">{websiteOnly.map(provider => <li className="provider-picker-row" key={provider.id}>
      <AdditionalLogo id={provider.id}/><div className="provider-picker-copy"><h3>{provider.name}</h3><span className="provider-picker-status">Tracking unavailable</span></div>
      <button className="provider-picker-dashboard" disabled={!isTauri()} aria-label={`Open ${provider.name} dashboard`} title="Open dashboard · tracking unavailable" onClick={() => void dashboard(provider.id)}><Icon name="external" size={16}/></button>
    </li>)}</ul></details>}</details>
    {!spec && error && <p role="alert" className="quick-info">{error}</p>}
    {spec && <Modal title={`Connect ${spec.name}`} dismissible={!busy} onClose={() => { if (!busy) { setSelected(null); setToken(''); } }}><p className="modal-intro">{spec.description}</p><p className="quick-info">{spec.source === 'local' ? 'Read local usage metadata only. No credentials are read and no network requests are made.' : spec.source === 'cli' ? `Start the installed ${spec.name} CLI and request account usage only. No model prompt is sent. The CLI manages its existing sign-in and local state. MeterLuma does not start login, approve interactive actions or change its profile.` : `Read-only usage requests go to ${Array.from(new Set(spec.requests.map(request => new URL(request.url).host))).join(', ')}. MeterLuma does not run inference, purchase credits or refresh another app’s credentials.`}</p><form className="feature-form" onSubmit={event => void connect(event)}>
      <label>Account label<input value={label} onChange={event => setLabel(event.target.value)} maxLength={60} disabled={busy}/></label>
      {spec.source === 'api' && <label>{spec.credentialLabel}<input type="password" value={token} onChange={event => setToken(event.target.value)} maxLength={16384} autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy}/></label>}
      {spec.credentialScope && <label>{spec.credentialScope.label}<input value={identifier} onChange={event => setIdentifier(event.target.value)} maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy}/></label>}
      <label className="quick-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy}/>Allow this provider’s read-only usage connection.</label>
      <p className="quick-info">{spec.source === 'local' ? 'Local metadata does not establish live account or billing status. Disconnect stops reads and preserves the original files.' : spec.source === 'cli' ? 'No credential is saved by MeterLuma. Disconnect stops the usage reader and keeps your CLI sign-in.' : 'Only a successful connection is saved, using macOS Keychain or Windows account encryption. Keys never enter preferences or exports. Disconnect removes the saved key.'}</p>
      {error && <p role="alert" className="quick-info">{error}</p>}
      <button className="button primary full-width" disabled={busy || spec.source === 'api' && !token.trim() || !!spec.credentialScope && !identifier.trim() || !acknowledged}>{busy ? 'Checking provider…' : `Connect ${spec.name}`}</button>
    </form></Modal>}
  </section>;
}
