import type { Provider, Settings } from './model';
import { money } from './model';
import { Icon } from './icons';
import { ProviderLogo } from './ProviderLogo';
import { formatDateTime, resetText, short, visibleMetrics } from './format';
import { coverage, dayValue } from './coverage';
import { UnofficialBadge } from './ProviderNotes';

type Display = Pick<Settings, 'resetStyle' | 'timeFormat'>;

function HistorySummary({ provider }: { provider: Provider }) {
  const history = provider.history;
  if (!history?.available) return <p className="notice">No recorded Claude Code activity was found in this local profile yet.</p>;
  const range = coverage(history);
  const today = dayValue(history, history.days.find(day => day.date === history.today));
  return <>
    <div className="quota-hero"><span className="quota-value">{today ? short(today.totalTokens) : '—'}</span><span className="quota-caption">{today ? 'tokens today' : 'today not recorded'}<br/>recorded on this device</span></div>
    <div className="metrics history-metrics">
      <div className="metric-label"><span>{range.label}</span><span><strong>{range.start === null ? 'No records' : `${short(range.total)} tokens`}</strong></span></div>
      {range.priced && range.cost !== undefined && <div className="metric-label"><span>Estimated API value</span><span><strong>~{money(range.cost)}</strong></span></div>}
      <p className="cached-quota-note">From local Claude Code logs. No sign-in or quotas are read.</p>
    </div>
  </>;
}

export function ProviderCard({ provider, remaining, now, onDetails, demo = true, display = { resetStyle: 'relative', timeFormat: 'auto' } }: { provider: Provider; remaining: boolean; now: number; onDetails: () => void; demo?: boolean; display?: Display }) {
  const metrics = visibleMetrics(provider, now);
  const primary = metrics[0];
  return <article className="provider-card">
    <header className="provider-heading">
      <div className={`provider-logo ${provider.id}`} aria-hidden="true"><ProviderLogo id={provider.id}/></div>
      <div><h3>{provider.name}</h3><span className="provider-plan">{provider.accountLabel ? `${provider.accountLabel} · ` : ''}{provider.historyOnly ? 'Local history only' : provider.cached ? 'Cached quotas' : provider.quotaState === 'rate_limited' ? 'Rate limited · local history' : !provider.fetchedAt && !demo ? 'Recorded activity' : `${provider.plan} plan`}{provider.id === 'cursor' && <> <UnofficialBadge/></>}</span></div>
      <span className="connection-dot" data-state={provider.historyOnly ? 'history' : demo || provider.fetchedAt && !provider.cached ? 'live' : provider.quotaState ?? 'unavailable'} title={demo ? 'Sample connection' : provider.historyOnly ? 'Recorded local history' : provider.quotaState === 'rate_limited' ? 'Usage requests rate limited' : provider.cached ? 'Cached quotas' : provider.fetchedAt ? 'Live connection' : 'Recorded device activity'} />
    </header>
    {provider.historyOnly ? <HistorySummary provider={provider}/> : <>
      {provider.cached && <p className="cached-quota-note">Last fetched {formatDateTime(provider.fetchedAt!, display.timeFormat)}. Refresh unavailable.</p>}
      {primary ? <div className="quota-hero"><span className="quota-value">{Math.max(0, 100 - primary.usedPercent).toLocaleString(undefined, { maximumFractionDigits: 1 })}<small>%</small></span><span className="quota-caption">remaining<br/>{primary.label.toLowerCase()} allowance</span></div> : <p className="notice">Live allowances unavailable.{provider.history?.available ? ' Local history is available in Activity.' : ''}</p>}
      <div className="metrics">{metrics.map(metric => {
        const displayed = remaining ? Math.max(0, 100 - metric.usedPercent) : metric.usedPercent;
        return <div className="metric" key={metric.label}>
          <div className="metric-label"><span>{metric.label}</span><span><strong>{displayed.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</strong> {remaining ? 'left' : 'used'}</span></div>
          <div className="meter" role="progressbar" aria-label={`${provider.cached ? 'Cached ' : ''}${provider.name} ${metric.label} ${remaining ? 'remaining' : 'used'}`} aria-valuemin={0} aria-valuemax={Math.max(100, displayed)} aria-valuenow={displayed}><span style={{ width: `${Math.min(100, displayed)}%` }}/></div>
          <span className="reset"><Icon name="clock" size={12}/>{resetText(metric, now, display)}</span>
        </div>;
      })}</div>
    </>}
    <footer className="provider-footer"><span>{provider.spendToday === null ? provider.historyOnly ? 'Recorded device activity' : provider.cached ? 'Cached plan limits' : metrics.length ? 'Live plan limits' : 'Recorded device activity' : <>Today <strong>{money(provider.spendToday)}</strong></>}</span><button onClick={onDetails} aria-label={`View ${provider.name} details`}><Icon name="arrow" size={17}/></button></footer>
  </article>;
}
