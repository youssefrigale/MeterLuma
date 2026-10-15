import type { ProviderId, Settings, UsageDay, UsageHistory as History } from './model';
import { money } from './model';
import { count, formatDay, formatTime, plural, short } from './format';
import { coverage, dayValue } from './coverage';

export const CLAUDE_RETENTION = 'Claude Code keeps local transcripts for 30 days by default (cleanupPeriodDays), so older days are usually not recorded.';

export function UsageHistory({ history, compact = false, providerId, timeFormat = 'auto' }: { history: History; compact?: boolean; providerId?: ProviderId; timeFormat?: Settings['timeFormat'] }) {
  const period = history.periodDays ?? history.days.length;
  const range = coverage(history);
  const unrecorded = history.days.length - range.recorded.length;
  const sum = (days: UsageDay[]) => days.reduce((total, day) => total + day.totalTokens, 0);
  const bucketSize = history.days.length > 90 ? 7 : 1;
  const buckets = Array.from({ length: Math.ceil(history.days.length / bucketSize) }, (_, index) => {
    const days = history.days.slice(index * bucketSize, (index + 1) * bucketSize);
    const recorded = days.filter(day => range.isRecorded(day.date));
    return { label: days.length > 1 ? `${days[0].date} – ${days.at(-1)!.date}` : days[0].date, size: days.length, recorded: recorded.length, total: sum(recorded) };
  });
  const max = Math.max(1, ...buckets.map(bucket => bucket.total));
  const bars = buckets.map(bucket => bucket.recorded ? <i key={bucket.label} title={`${bucket.label}: ${count(bucket.total)} tokens${bucket.recorded < bucket.size ? ` (${bucket.recorded} of ${bucket.size} days recorded)` : ''}`} style={{ height: `${bucket.total / max * 100}%` }}/> : <i key={bucket.label} className="unrecorded" title={`${bucket.label}: Not recorded`}/>);
  const chartLabel = range.start === null ? `No token usage recorded in the last ${period} days` : range.shorter ? `Recorded token usage since ${formatDay(range.start)}: ${count(range.total)} tokens; ${plural(unrecorded, 'earlier day')} not recorded` : `Recorded token usage over ${period} days: ${count(range.total)} tokens`;
  const today = dayValue(history, history.days.find(day => day.date === history.today));
  const yesterday = dayValue(history, history.days.at(-2));
  const tokens = (day: UsageDay | null | undefined) => day === undefined ? 'Unavailable' : day === null ? 'Not recorded' : `${short(day.totalTokens)} tokens`;
  const withCost = (text: string, cost: number | null | undefined) => range.priced && typeof cost === 'number' ? `~${money(cost)} · ${text}` : text;
  const rows: [string, string, string | undefined][] = [
    ['Today', withCost(tokens(today), today?.estimatedCostUsd), today ? `${count(today.totalTokens)} recorded tokens` : undefined],
    ['Yesterday', withCost(tokens(yesterday), yesterday?.estimatedCostUsd), yesterday ? `${count(yesterday.totalTokens)} recorded tokens` : undefined],
    [range.label, range.start === null ? 'No records' : withCost(`${short(range.total)} tokens`, range.cost), range.start === null ? undefined : `${count(range.total)} recorded tokens${range.priced && range.cost !== undefined ? `; estimated API value ${money(range.cost)}` : ''}`],
  ];
  const unpriced = range.priced && range.unpriced > 0 ? `Excludes ${count(range.unpriced)} tokens from models without a known price.` : '';
  const scanned = `Scanned ${formatTime(history.scannedAt, timeFormat)}.`;
  if (compact) {
    const percentage = (value: number) => range.total > 0 && value / range.total * 100 < 0.1 ? '<0.1%' : `${(range.total > 0 ? value / range.total * 100 : 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    return <section className="usage-history quick-activity" aria-label="Recorded device activity">
      <dl className="quick-usage-totals">{rows.map(([label, text, title]) => <div key={label}><dt>{label}</dt><dd title={title}>{text}</dd></div>)}</dl>
      {unpriced && <p className="quick-info quick-unpriced">{unpriced}</p>}
      <div className="quick-inline-trend"><h3>Usage trend</h3><div className="quick-sparkbars" role="img" aria-label={chartLabel}>{bars}</div></div>
      <section className="quick-models" aria-label="Model usage"><dl>{history.models.slice(0, 5).map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd title={`${count(model.totalTokens)} tokens`}>{percentage(model.totalTokens)}</dd></div>)}</dl>{!history.models.length && <p className="quick-info">No model activity recorded.</p>}{history.models.length > 5 && <details className="quick-more-models"><summary>{history.models.length - 5} more models</summary><dl>{history.models.slice(5).map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd>{percentage(model.totalTokens)}</dd></div>)}</dl></details>}</section>
      <details className="quick-data-note"><summary>{range.priced ? 'Est. API value · This device' : 'Recorded on this device'}{range.shorter ? ` · ${range.label}` : ''}{history.partial ? ' · Partial' : ''}</summary><p>Local session logs across sign-ins in this profile. Other devices and unrecorded activity are excluded. {history.partial && 'Some logs could not be included.'} {unrecorded > 0 && `${plural(unrecorded, 'day')} in this window ${unrecorded === 1 ? 'has' : 'have'} no local logs and ${unrecorded === 1 ? 'is' : 'are'} shown as not recorded, not as zero.`} {providerId === 'claude' && CLAUDE_RETENTION} Dollar amounts estimate token value at standard global API rates checked October 15, 2026; they are not subscription charges or bills. Fast mode is valued at its published 2× rate on Opus 5.5, Opus 5 and Opus 4.8. Tool fees, regional premiums, historical prices and discounts are excluded. Cache writes use their logged duration or five minutes if unspecified. Tokens from models without a known price are left out of dollar amounts. {scanned}</p></details>
    </section>;
  }
  const lastFourteen = history.days.slice(-14);
  const comparable = lastFourteen.length === 14 && lastFourteen.every(day => range.isRecorded(day.date));
  const recent = sum(history.days.slice(-7));
  const prior = sum(history.days.slice(-14, -7));
  return <section className="usage-history" aria-label="Recorded device activity">
    <div className="usage-history-heading"><h3>Token usage</h3><span>This device</span></div>
    <dl>{rows.map(([label, text, title]) => <div key={label}><dt>{label}</dt><dd title={title}>{text}</dd></div>)}</dl>
    {unpriced && <p className="usage-history-note">{unpriced}</p>}
    <div className="usage-history-heading"><h3>{bucketSize === 7 ? 'Weekly activity' : 'Daily activity'}</h3><span>{period} days</span></div>
    <div className="usage-history-chart" role="img" aria-label={chartLabel}>{bars}</div>
    {unrecorded > 0 && <p className="usage-history-legend"><i className="unrecorded-key" aria-hidden="true"/>{range.start === null ? 'Not recorded: no local logs in this window.' : `Not recorded: ${plural(unrecorded, 'day')} before ${formatDay(range.start)} ${unrecorded === 1 ? 'has' : 'have'} no local logs. They are not zero-usage days.`}</p>}
    {range.recorded.length > 0 && <p className="usage-history-note">Daily average: {short(range.total / range.recorded.length)} tokens over {plural(range.recorded.length, 'recorded day')}. {comparable ? `Last 7 days: ${short(recent)} tokens · Previous 7: ${short(prior)} tokens. ${prior > 0 ? `${((recent - prior) / prior * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% change.` : 'No percentage comparison available.'}` : 'A week-over-week comparison needs 14 recorded days.'}</p>}
    <div className="usage-history-heading"><h3>Models</h3><span>By tokens</span></div>
    {history.models.length ? <dl>{history.models.map(model => <div key={model.name}><dt title={model.name}>{model.name}</dt><dd title={`${count(model.totalTokens)} tokens`}>{range.total > 0 ? (model.totalTokens / range.total * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) : 0}%</dd></div>)}</dl> : <p>No model usage recorded in this period.</p>}
    <p className="usage-history-note">Read from local session logs. Includes activity on this device across local sign-ins; other devices and unrecorded activity are excluded. {history.partial && 'Some logs could not be included; these totals are partial.'} {providerId === 'claude' && CLAUDE_RETENTION} {range.priced && 'Dollar amounts estimate API value at standard rates; they are not bills.'}</p>
    <small>{scanned.slice(0, -1)}</small>
  </section>;
}
