import type { UsageHistory as History } from './model';

const count = (value: number) => value.toLocaleString();
const short = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export function UsageHistory({ history }: { history: History }) {
  const total = history.days.reduce((sum, day) => sum + day.totalTokens, 0);
  const max = Math.max(1, ...history.days.map(day => day.totalTokens));
  const today = history.days.find(day => day.date === history.today);
  const yesterday = history.days.at(-2);
  return <section className="usage-history" aria-label="Recorded device activity">
    <div className="usage-history-heading"><h3>Token usage</h3><span>This device</span></div>
    <dl>{[['Today', today?.totalTokens], ['Yesterday', yesterday?.totalTokens], ['Last 30 days', total]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={typeof value === 'number' ? `${count(value)} recorded tokens` : undefined}>{typeof value === 'number' ? `${short(value)} tokens` : 'Unavailable'}</dd></div>)}</dl>
    <div className="usage-history-heading"><h3>Daily activity</h3><span>30 days</span></div>
    <div className="usage-history-chart" role="img" aria-label={`Recorded token usage over 30 days: ${count(total)} tokens`}>{history.days.map(day => <i key={day.date} title={`${day.date}: ${count(day.totalTokens)} tokens`} style={{ height: `${day.totalTokens / max * 100}%` }}/>)}</div>
    <div className="usage-history-heading"><h3>Models</h3><span>By tokens</span></div>
    {history.models.length ? <dl>{history.models.map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd title={`${count(model.totalTokens)} tokens`}>{total > 0 ? (model.totalTokens / total * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) : 0}%</dd></div>)}</dl> : <p>No model usage recorded in this period.</p>}
    <p className="usage-history-note">Read from local session logs. Includes activity on this device across local sign-ins; other devices and unrecorded activity are excluded. {history.partial && 'Some logs could not be included; these totals are partial.'}</p>
    <small>Scanned {new Date(history.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
  </section>;
}
