import { dailySpend, money, type Metric, type Provider, type ProviderId, type Settings } from './model';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { Icon } from './icons';
import { UsageHistory } from './UsageHistory';
import { retryCountdown } from './providerState';
import { CLAUDE_LOCAL, formatTime, neutralColors, resetText, short, visibleMetrics } from './format';
import { dayValue } from './coverage';
import { UnofficialNote } from './ProviderNotes';
import { CURSOR_HISTORY_NOTE } from './exportUsage';

const websites = {
  claude: { status: 'https://status.claude.com/', usage: 'https://claude.ai/settings/usage' },
  codex: { status: 'https://status.openai.com/', usage: 'https://chatgpt.com/codex/settings/usage' },
  cursor: { status: 'https://status.cursor.com/', usage: 'https://cursor.com/dashboard' },
};

export const colors = neutralColors;
const sampleModels = { claude: [['Opus', 62], ['Sonnet', 35], ['Haiku', 3]], codex: [['Codex', 78], ['Codex Mini', 22]], cursor: [['Auto', 72], ['Selected model', 28]] } as const;
export const thirtyDaySpend = (id: ProviderId) => [...dailySpend[id], ...dailySpend[id], ...dailySpend[id]].slice(-30).reduce((sum, value) => sum + value, 0);

function QuotaMetric({ provider, metric, settings, now }: { provider: Provider; metric: Metric; settings: Settings; now: number }) {
  const remaining = Math.max(0, 100 - Math.min(100, metric.usedPercent));
  const value = settings.remaining ? remaining : 100 - remaining;
  return <div className="quick-metric"><div className="quick-metric-title"><h3>{metric.label}</h3><i role="img" className={remaining <= 10 ? 'critical' : remaining <= 25 ? 'low' : ''} aria-label={remaining <= 10 ? 'Very little allowance left' : remaining <= 25 ? 'Low allowance' : 'Allowance available'}/></div><div className="quick-meter" role="progressbar" aria-label={`${provider.cached ? 'Cached ' : ''}${provider.name} ${metric.label} ${settings.remaining ? 'remaining' : 'used'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{ width: `${value}%` }}/></div><div className="quick-metric-caption"><span>{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}% {settings.remaining ? 'left' : 'used'}</span><span>{resetText(metric, now, settings)}</span></div></div>;
}

function localSummary(provider: Provider) {
  const history = provider.history;
  if (!history?.available) return provider.historyLoading ? 'Reading recorded Claude Code history…' : 'No recorded Claude Code activity found in this local profile yet.';
  const today = dayValue(history, history.days.find(day => day.date === history.today));
  return `Local history only · ${today ? `${short(today.totalTokens)} tokens today` : 'today not recorded'}`;
}

export function QuickProvider({ provider, settings, now, detailed = false, connectionError, reconnect, retry }: { provider: Provider; settings: Settings; now: number; detailed?: boolean; connectionError?: string; reconnect?: () => void; retry?: () => void }) {
  const [linkError, setLinkError] = useState('');
  const needsSignIn = !connectionError || /sign.in|subscription|API.key|official.*CLI/i.test(connectionError);
  const limited = provider.quotaState === 'rate_limited';
  const metrics = visibleMetrics(provider, now);
  const coolingDown = limited && typeof provider.retryAt === 'number' && provider.retryAt > now;
  async function openWebsite(page: 'status' | 'usage') {
    if (!isTauri()) { window.open(websites[provider.id][page], '_blank', 'noopener,noreferrer'); return; }
    try { await invoke('open_provider_page', { providerId: provider.id, page }); }
    catch { setLinkError('The provider page could not be opened.'); }
  }
  return <article className={`quick-provider ${detailed ? 'quick-detail' : ''}`}>
    {!detailed && <div className="quick-provider-heading"><h2>{provider.name}</h2><span>{provider.accountLabel ? `${provider.accountLabel} · ` : ''}{provider.plan}</span></div>}
    {detailed && <div className="quick-provider-links"><button onClick={() => void openWebsite('status')}>Status <Icon name="external" size={12}/></button><button onClick={() => void openWebsite('usage')}>Usage dashboard <Icon name="external" size={12}/></button></div>}
    {detailed && provider.id === 'cursor' && <UnofficialNote className="quick-info"/>}
    {provider.historyOnly && <p className="quick-info quick-local-note">{detailed ? CLAUDE_LOCAL : localSummary(provider)}</p>}
    {!provider.historyOnly && !metrics.length && !detailed && <p className="quick-info">{provider.history?.available ? 'Live allowances unavailable. Open this provider to see recorded device activity.' : 'Live allowances unavailable.'}</p>}
    {!provider.historyOnly && !metrics.length && detailed && <><div className="quick-metrics quick-metrics-unavailable" aria-label="Live quotas unavailable">{(provider.id === 'cursor' ? ['Monthly'] : ['Session', 'Weekly']).map(label => <div className="quick-metric" key={label}><div className="quick-metric-title"><h3>{label}</h3><i className="unavailable" aria-hidden="true"/></div><div className="quick-meter"><span/></div><div className="quick-metric-caption"><span>{limited ? 'Rate limited' : 'Unavailable'}</span><span>Reset unavailable</span></div></div>)}</div><div className="quick-reconnect" role="status"><span title={connectionError}>{limited ? coolingDown ? `Usage paused. Retrying in ${retryCountdown(provider.retryAt!, now)}.` : 'Usage requests are rate limited.' : needsSignIn ? `Renew your ${provider.name} sign-in to see limits.` : 'Live limits unavailable. Try refreshing.'}</span><button disabled={coolingDown} onClick={!limited && needsSignIn ? reconnect : retry}>{!limited && needsSignIn ? 'Connect' : coolingDown ? 'Waiting' : 'Retry'}</button></div></>}
    {provider.cached && metrics.length > 0 && <div className="quick-reconnect quick-cache-notice" role="status"><span>Cached quotas from {formatTime(provider.fetchedAt!, settings.timeFormat)}{coolingDown ? `. Retry in ${retryCountdown(provider.retryAt!, now)}` : '. Refresh unavailable'}.</span></div>}
    {metrics.length > 0 && <div className="quick-metrics">{(detailed ? metrics.slice(0, 2) : metrics).map(metric => <QuotaMetric key={metric.label} provider={provider} metric={metric} settings={settings} now={now}/>)}</div>}
    {detailed && metrics.length > 2 && <details className="quick-more-limits"><summary>More limits ({metrics.length - 2})</summary>{metrics.slice(2).map(metric => <QuotaMetric key={metric.label} provider={provider} metric={metric} settings={settings} now={now}/>)}</details>}
    {detailed && <>{settings.demo ? <><section className="quick-statistics" aria-label={`${provider.name} sample spending`}><dl>{(['Today', 'Yesterday', 'Last 30 days'] as const).map((label, index) => <div key={label}><dt>{label}</dt><dd>{money(index === 0 ? provider.spendToday! : index === 1 ? dailySpend[provider.id].at(-2)! : thirtyDaySpend(provider.id))}</dd></div>)}</dl></section><section className="quick-inline-trend"><h3>Usage trend</h3><div className="quick-sparkbars" role="img" aria-label={`${provider.name} simulated spending over 14 days`}>{dailySpend[provider.id].map((value, index, values) => <i key={index} style={{ height: `${Math.max(5, value / Math.max(...values) * 100)}%` }}/>)}</div></section><section className="quick-models"><dl>{sampleModels[provider.id].map(([model, percentage]) => <div key={model}><dt>{model}</dt><dd>{percentage}%</dd></div>)}</dl><p className="quick-sample-note">Illustrative · sample data</p></section></> : provider.history?.available ? <UsageHistory history={provider.history} compact providerId={provider.id} timeFormat={settings.timeFormat}/> : provider.id === 'cursor' ? <p className="quick-info quick-history-note">{CURSOR_HISTORY_NOTE}</p> : <section className="quick-statistics"><dl>{['Today', 'Yesterday', `Last ${settings.historyDays} days`].map(label => <div key={label}><dt>{label}</dt><dd>Unavailable</dd></div>)}</dl><p className="quick-info">{provider.historyLoading ? 'Reading recorded local usage…' : connectionError?.includes('history could not be read') ? 'Recorded local history could not be read. Try refreshing.' : 'No recorded activity found in this local profile.'}</p></section>}
    </>}
    {linkError && <p role="status" className="quick-info">{linkError}</p>}
  </article>;
}
