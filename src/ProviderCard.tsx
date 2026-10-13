import type { Provider } from './model';
import { countdown, money } from './model';
import { Icon } from './icons';
import { ProviderLogo } from './ProviderLogo';

export function ProviderCard({ provider, remaining, now, onDetails, demo = true }: { provider: Provider; remaining: boolean; now: number; onDetails: () => void; demo?: boolean }) {
  const primary = provider.metrics[0];
  return <article className="provider-card" style={{ '--provider-color': provider.color } as React.CSSProperties}>
    <header className="provider-heading">
      <div className={`provider-logo ${provider.id}`} aria-hidden="true"><ProviderLogo id={provider.id}/></div>
      <div><h3>{provider.name}</h3><span className="provider-plan">{provider.plan} plan</span></div>
      <span className="connection-dot" title={demo ? 'Sample connection' : 'Live connection'} />
    </header>
    <div className="quota-hero"><span className="quota-value">{Math.max(0, 100 - primary.usedPercent).toLocaleString(undefined, { maximumFractionDigits: 1 })}<small>%</small></span><span className="quota-caption">remaining<br/>{primary.label.toLowerCase()} allowance</span></div>
    <div className="metrics">{provider.metrics.map(metric => {
      const displayed = remaining ? Math.max(0, 100 - metric.usedPercent) : metric.usedPercent;
      return <div className="metric" key={metric.label}>
        <div className="metric-label"><span>{metric.label}</span><span><strong>{displayed.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</strong> {remaining ? 'left' : 'used'}</span></div>
        <div className="meter" role="progressbar" aria-label={`${provider.name} ${metric.label} ${remaining ? 'remaining' : 'used'}`} aria-valuemin={0} aria-valuemax={Math.max(100, displayed)} aria-valuenow={displayed}><span style={{ width: `${Math.min(100, displayed)}%` }}/></div>
        <span className="reset"><Icon name="clock" size={12}/>{metric.resetAt === null ? 'Reset time unavailable' : countdown(metric.resetAt, now) === 'Reset due' ? 'Reset due · refresh to update' : `Resets in ${countdown(metric.resetAt, now)}`}</span>
      </div>;
    })}</div>
    <footer className="provider-footer"><span>{provider.spendToday === null ? 'Live plan limits' : <>Today <strong>{money(provider.spendToday)}</strong></>}</span><button onClick={onDetails} aria-label={`View ${provider.name} details`}><Icon name="arrow" size={17}/></button></footer>
  </article>;
}
