import type { CSSProperties } from 'react';
import { countdown, dailySpend, money, type Provider, type ProviderId, type Settings } from './model';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { UsageHistory } from './UsageHistory';

const websites = {
  claude: { status: 'https://status.claude.com/', usage: 'https://claude.ai/settings/usage' },
  codex: { status: 'https://status.openai.com/', usage: 'https://chatgpt.com/codex/settings/usage' },
  cursor: { status: 'https://status.cursor.com/', usage: 'https://cursor.com/dashboard' },
};

export const colors = { claude: '#515157', codex: '#85858c', cursor: '#b8b8bf' };
const sampleModels = { claude: [['Opus', 62], ['Sonnet', 35], ['Haiku', 3]], codex: [['Codex', 78], ['Codex Mini', 22]], cursor: [['Auto', 72], ['Selected model', 28]] } as const;
export const thirtyDaySpend = (id: ProviderId) => [...dailySpend[id], ...dailySpend[id], ...dailySpend[id]].slice(-30).reduce((sum, value) => sum + value, 0);

export function QuickProvider({ provider, settings, now, detailed = false }: { provider: Provider; settings: Settings; now: number; detailed?: boolean }) {
  const [linkError, setLinkError] = useState('');
  async function openWebsite(page: 'status' | 'usage') {
    if (!isTauri()) { window.open(websites[provider.id][page], '_blank', 'noopener,noreferrer'); return; }
    try { await invoke('open_provider_page', { providerId: provider.id, page }); }
    catch { setLinkError('The provider page could not be opened.'); }
  }
  return <article className={`quick-provider ${detailed ? 'quick-detail' : ''}`} style={{ '--provider-color': colors[provider.id] } as CSSProperties}>
    <div className="quick-provider-heading">{detailed ? <span className="quick-detail-caption">Plan allowance</span> : <h2>{provider.name}</h2>}<span>{provider.plan}</span></div>
    {detailed && <div className="quick-provider-links"><button onClick={() => void openWebsite('status')}>Status ↗</button><button onClick={() => void openWebsite('usage')}>Usage dashboard ↗</button></div>}
    {!provider.metrics.length && <p className="quick-info">{detailed ? 'Live allowances unavailable. Your recorded device activity appears below.' : 'Live allowances unavailable. Open this provider to see recorded device activity.'}</p>}
    <div className="quick-metrics">{provider.metrics.map(metric => {
      const remaining = Math.max(0, 100 - Math.min(100, metric.usedPercent));
      const value = settings.remaining ? remaining : 100 - remaining;
      const reset = countdown(metric.resetAt, now);
      const clock = metric.resetAt === null ? '' : new Date(metric.resetAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(settings.timeFormat !== 'auto' ? { hour12: settings.timeFormat === '12' } : {}) });
      return <div className="quick-metric" key={metric.label}><div className="quick-metric-title"><h3>{metric.label}</h3><i role="img" className={remaining <= 10 ? 'critical' : remaining <= 25 ? 'low' : ''} aria-label={remaining <= 10 ? 'Very little allowance left' : remaining <= 25 ? 'Low allowance' : 'Allowance available'}/></div><div className="quick-meter" role="progressbar" aria-label={`${provider.name} ${metric.label} ${settings.remaining ? 'remaining' : 'used'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{ width: `${value}%` }}/></div><div className="quick-metric-caption"><span>{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}% {settings.remaining ? 'left' : 'used'}</span><span>{metric.resetAt === null || reset === 'Reset due' ? reset : settings.resetStyle === 'absolute' ? `Resets ${clock}` : `Resets in ${reset}`}</span></div></div>;
    })}</div>
    {detailed && <><section className="quick-statistics" aria-label={`${provider.name} spending`}><div className="quick-subheading"><h3>Spending</h3><span>{settings.demo ? 'Sample · USD' : 'USD'}</span></div><dl>{(['Today', 'Yesterday', 'Last 30 days'] as const).map((label, index) => <div key={label}><dt>{label}</dt><dd>{settings.demo ? money(index === 0 ? provider.spendToday! : index === 1 ? dailySpend[provider.id].at(-2)! : thirtyDaySpend(provider.id)) : 'Unavailable'}</dd></div>)}</dl></section>
      {settings.demo ? <><section className="quick-trend"><h3>Usage trend <span>14 sample days</span></h3><div className="quick-sparkbars" role="img" aria-label={`${provider.name} simulated spending over 14 days`}>{dailySpend[provider.id].map((value, index, values) => <i key={index} style={{ height: `${Math.max(5, value / Math.max(...values) * 100)}%` }}/>)}</div></section><section className="quick-models"><div className="quick-subheading"><h3>Model mix</h3><span>Illustrative</span></div><dl>{sampleModels[provider.id].map(([model, percentage]) => <div key={model}><dt>{model}</dt><dd>{percentage}%</dd></div>)}</dl></section></> : provider.history?.available ? <UsageHistory history={provider.history}/> : <p className="quick-info">{provider.historyLoading ? 'Reading recorded local usage…' : 'No readable local usage history is available for this provider. Spending totals are unavailable.'}</p>}
    </>}
    {linkError && <p role="status" className="quick-info">{linkError}</p>}
  </article>;
}
