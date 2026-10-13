import type { Provider, ProviderId } from './model';
import { dailySpend, money } from './model';

export function SpendChart({ providers, days = 14 }: { providers: Provider[]; days?: 7 | 14 }) {
  const series = Array.from({ length: days }, (_, index) => {
    const values = providers.map(provider => ({ id: provider.id, color: provider.color, value: dailySpend[provider.id as ProviderId][14 - days + index] }));
    return { values, total: values.reduce((sum, point) => sum + point.value, 0) };
  });
  const max = Math.max(10, ...series.map(point => point.total));
  return <div className="chart" aria-label={`Sample estimated spend over ${days} days`}>
    <div className="chart-axis"><span>{money(max)}</span><span>{money(max / 2)}</span><span>$0</span></div>
    <div className="chart-plot">
      <div className="chart-grid"><span/><span/><span/></div>
      <div className="chart-bars">{series.map((day, index) => {
        const date = new Date(); date.setDate(date.getDate() - days + 1 + index);
        return <div className="bar-column" key={index} title={`${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${money(day.total)} (sample)`}>
          <div className="bar-stack" style={{ height: `${day.total / max * 100}%` }}>{day.values.map(value => <span key={value.id} style={{ background: value.color, flex: value.value }}/>)}</div>
          <span className="bar-label">{index === days - 1 ? 'Today' : index % (days === 7 ? 2 : 4) === 0 ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        </div>;
      })}</div>
    </div>
  </div>;
}
