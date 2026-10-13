import type { Provider } from './model';
import { countdown, money } from './model';
import { Icon } from './icons';

export function ProviderCard({ provider, remaining, now, onDetails }: { provider: Provider; remaining: boolean; now: number; onDetails: () => void }) {
  const primary = provider.metrics[0];
  return <article className="provider-card" style={{ '--provider-color': provider.color } as React.CSSProperties}>
    <header className="provider-heading">
      <div className={`provider-logo ${provider.id}`} aria-hidden="true">{provider.initials}</div>
      <div><h3>{provider.name}</h3><span className="provider-plan">{provider.plan} plan</span></div>
      <span className="connection-dot" title="Sample connection" />
    </header>
    <div className="quota-hero"><span className="quota-value">{100 - primary.usedPercent}<small>%</small></span><span className="quota-caption">remaining<br/>{primary.label.toLowerCase()} allowance</span></div>
    <div className="metrics">{provider.metrics.map(metric => {
      const displayed = remaining ? 100 - metric.usedPercent : metric.usedPercent;
      return <div className="metric" key={metric.label}>
        <div className="metric-label"><span>{metric.label}</span><span><strong>{displayed}%</strong> {remaining ? 'left' : 'used'}</span></div>
        <div className="meter" role="progressbar" aria-label={`${provider.name} ${metric.label} ${remaining ? 'remaining' : 'used'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayed}><span style={{ width: `${displayed}%` }}/></div>
        <span className="reset"><Icon name="clock" size={12}/>Resets {countdown(metric.resetAt, now) === 'Reset due' ? 'soon' : `in ${countdown(metric.resetAt, now)}`}</span>
      </div>;
    })}</div>
    <footer className="provider-footer"><span>Today <strong>{money(provider.spendToday)}</strong></span><button onClick={onDetails} aria-label={`View ${provider.name} details`}><Icon name="arrow" size={17}/></button></footer>
  </article>;
}
