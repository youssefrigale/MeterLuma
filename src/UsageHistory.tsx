import type { UsageHistory as History } from './model';
import { money } from './model';

const count = (value: number) => value.toLocaleString();
const short = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export function UsageHistory({ history, compact = false }: { history: History; compact?: boolean }) {
  const total = history.days.reduce((sum, day) => sum + day.totalTokens, 0);
  const period = history.periodDays ?? history.days.length;
  const recent = history.days.slice(-7).reduce((sum, day) => sum + day.totalTokens, 0);
  const prior = history.days.slice(-14, -7).reduce((sum, day) => sum + day.totalTokens, 0);
  const bucketSize = history.days.length > 90 ? 7 : 1;
  const buckets = Array.from({ length: Math.ceil(history.days.length / bucketSize) }, (_, index) => {
    const days = history.days.slice(index * bucketSize, (index + 1) * bucketSize);
    return { label: days.length > 1 ? `${days[0].date} – ${days.at(-1)!.date}` : days[0].date, total: days.reduce((sum, day) => sum + day.totalTokens, 0) };
  });
  const max = Math.max(1, ...buckets.map(bucket => bucket.total));
  const today = history.days.find(day => day.date === history.today);
  const yesterday = history.days.at(-2);
  if (compact) {
    const estimated = history.days.every(day => typeof day.estimatedCostUsd === 'number') ? history.days.reduce((sum, day) => sum + day.estimatedCostUsd!, 0) : undefined;
    const hasPrices = history.days.some(day => day.totalTokens > 0 && typeof day.estimatedCostUsd === 'number');
    const rows = [['Today', today?.totalTokens, hasPrices ? today?.estimatedCostUsd : undefined], ['Yesterday', yesterday?.totalTokens, hasPrices ? yesterday?.estimatedCostUsd : undefined], [`Last ${period} days`, total, hasPrices ? estimated : undefined]] as const;
    const percentage = (tokens: number) => total > 0 && tokens / total * 100 < 0.1 ? '<0.1%' : `${(total > 0 ? tokens / total * 100 : 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    return <section className="usage-history quick-activity" aria-label="Recorded device activity">
      <dl className="quick-usage-totals">{rows.map(([label, tokens, cost]) => <div key={label}><dt>{label}</dt><dd title={typeof tokens === 'number' ? `${count(tokens)} recorded tokens${typeof cost === 'number' ? `; estimated API value ${money(cost)}` : ''}` : undefined}>{typeof tokens === 'number' ? <>{typeof cost === 'number' && <><span className="quick-estimate">~{money(cost)}</span><span className="quick-value-separator"> · </span></>}{short(tokens)} tokens</> : 'Unavailable'}</dd></div>)}</dl>
      <div className="quick-inline-trend"><h3>Usage trend</h3><div className="quick-sparkbars" role="img" aria-label={`Recorded token usage over ${period} days: ${count(total)} tokens`}>{buckets.map(bucket => <i key={bucket.label} title={`${bucket.label}: ${count(bucket.total)} tokens`} style={{ height: `${bucket.total / max * 100}%` }}/>)}</div></div>
      <section className="quick-models" aria-label="Model usage"><dl>{history.models.slice(0, 5).map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd title={`${count(model.totalTokens)} tokens`}>{percentage(model.totalTokens)}</dd></div>)}</dl>{!history.models.length && <p className="quick-info">No model activity recorded.</p>}{history.models.length > 5 && <details className="quick-more-models"><summary>{history.models.length - 5} more models</summary><dl>{history.models.slice(5).map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd>{percentage(model.totalTokens)}</dd></div>)}</dl></details>}</section>
      <details className="quick-data-note"><summary>{hasPrices ? 'Est. API value · This device' : 'Recorded on this device'}{history.partial ? ' · Partial' : ''}</summary><p>Local session logs across sign-ins in this profile. Other devices and unrecorded activity are excluded. {history.partial && 'Some logs could not be included.'} Dollar amounts estimate token value at standard global API rates checked October 15, 2026; they are not subscription charges or bills. Tool fees, fast mode, regional premiums, historical prices and discounts are excluded. Cache writes use their logged duration or five minutes if unspecified. A day or period containing unknown model prices has no dollar total. Scanned {new Date(history.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p></details>
    </section>;
  }
  return <section className="usage-history" aria-label="Recorded device activity">
    <div className="usage-history-heading"><h3>Token usage</h3><span>This device</span></div>
    <dl>{[['Today', today?.totalTokens], ['Yesterday', yesterday?.totalTokens], [`Last ${period} days`, total]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={typeof value === 'number' ? `${count(value)} recorded tokens` : undefined}>{typeof value === 'number' ? `${short(value)} tokens` : 'Unavailable'}</dd></div>)}</dl>
    <div className="usage-history-heading"><h3>{bucketSize === 7 ? 'Weekly activity' : 'Daily activity'}</h3><span>{period} days</span></div>
    <div className="usage-history-chart" role="img" aria-label={`Recorded token usage over ${period} days: ${count(total)} tokens`}>{buckets.map(bucket => <i key={bucket.label} title={`${bucket.label}: ${count(bucket.total)} tokens`} style={{ height: `${bucket.total / max * 100}%` }}/>)}</div>
    {history.days.length >= 14 && <p className="usage-history-note">Last 7 days: {short(recent)} tokens · Previous 7: {short(prior)} tokens. {prior > 0 ? `${((recent - prior) / prior * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% change.` : 'No percentage comparison available.'}</p>}
    <div className="usage-history-heading"><h3>Models</h3><span>By tokens</span></div>
    {history.models.length ? <dl>{history.models.map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd title={`${count(model.totalTokens)} tokens`}>{total > 0 ? (model.totalTokens / total * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) : 0}%</dd></div>)}</dl> : <p>No model usage recorded in this period.</p>}
    <p className="usage-history-note">Read from local session logs. Includes activity on this device across local sign-ins; other devices and unrecorded activity are excluded. {history.partial && 'Some logs could not be included; these totals are partial.'}</p>
    <small>Scanned {new Date(history.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
  </section>;
}
