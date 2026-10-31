import { invoke, isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { KeychainAccess, keychainLocked } from '../KeychainAccess';
import type { Settings } from '../model';
import { formatTime } from '../format';
import { Icon } from '../icons';
import { QuotaMetric } from '../QuickProvider';
import { additionalProvider, type AdditionalAmount, type AdditionalResult } from './model';
import { OverviewCardHeading, type CardFold } from '../OverviewCardHeading';

export function amountText(amount: AdditionalAmount) {
  const numeric = Math.abs(amount.value) > 0 && Math.abs(amount.value) < 0.000001 ? amount.value > 0 ? '<0.000001' : '>-0.000001' : amount.value.toLocaleString(undefined, { minimumFractionDigits: amount.currency ? 2 : 0, maximumFractionDigits: 6 });
  return `${amount.currency ? `${amount.currency} ` : ''}${numeric}${amount.unit ? ` ${amount.unit}` : ''}`;
}
export function AdditionalProvider({ result, settings, now, detailed = false, retry, fold }: { result: AdditionalResult; settings: Settings; now: number; detailed?: boolean; retry: () => void; fold?: CardFold }) {
  const [linkError, setLinkError] = useState('');
  const spec = additionalProvider(result.id)!; const snapshot = result.snapshot;
  const locked = keychainLocked(result.error);
  const metrics = snapshot?.metrics.filter(metric => !snapshot.cached || (metric.resetAt === null ? now - snapshot.fetchedAt <= 300_000 : metric.resetAt > now)) ?? [];
  async function dashboard() {
    if (!isTauri()) { window.open(spec.dashboard, '_blank', 'noopener,noreferrer'); return; }
    try { await invoke('open_provider_page', { providerId: spec.id, page: 'usage' }); } catch { setLinkError('The provider dashboard could not be opened.'); }
  }
  return <article className={`quick-provider ${detailed ? 'quick-detail' : fold?.collapsed ? 'is-collapsed' : ''}`} aria-label={`${spec.name} usage`}>
    {!detailed && <OverviewCardHeading title={result.label === spec.name ? spec.name : `${spec.name} · ${result.label}`} label={result.label === spec.name ? spec.name : `${spec.name} · ${result.label}`} secondary={snapshot?.plan && <span title={snapshot.plan}>{snapshot.plan}</span>} fold={fold}/>}
    {detailed && <div className="quick-provider-links"><button onClick={() => void dashboard()}>Usage dashboard <Icon name="external" size={12}/></button></div>}
    {result.loading && !snapshot && <p className="quick-info" role="status">Reading {spec.name} usage…</p>}
    {snapshot?.cached && <p className="quick-info" role="status">Cached usage from {formatTime(snapshot.fetchedAt, settings.timeFormat)}.</p>}
    {metrics.map(metric => <QuotaMetric key={metric.label} provider={{ name: spec.name, cached: snapshot?.cached }} metric={metric} settings={settings} now={now}/>)}
    {!!snapshot?.amounts.length && <section className="quick-statistics" aria-label={`${spec.name} reported amounts`}><dl>{snapshot.amounts.map((amount, index) => <div key={`${amount.label}-${amount.currency}-${index}`}><dt>{amount.label}</dt><dd title={`${amount.value} ${amount.currency ?? amount.unit}`}>{amountText(amount)}</dd></div>)}</dl></section>}
    {snapshot?.notice && <p className="quick-info" role="status">{snapshot.notice}</p>}
    {result.error && <div className="quick-reconnect" role="status"><span>{locked ? 'macOS Keychain needs permission to read this saved connection.' : result.error}</span>{locked ? <KeychainAccess connectionId={`external-${result.id}`} name={spec.name} error={result.error} onUnlocked={retry} label="Unlock"/> : <button disabled={result.loading || !!result.retryAt && result.retryAt > now} onClick={retry}>Retry</button>}</div>}
    {detailed && snapshot && <p className="quick-info">Reported by {spec.name} · {formatTime(snapshot.fetchedAt, settings.timeFormat)}. Balances and credits are separate from local token-value estimates.</p>}
    {linkError && <p className="quick-info" role="status">{linkError}</p>}
  </article>;
}
