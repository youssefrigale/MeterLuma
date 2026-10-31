import { dailySpend, money, type Metric, type Provider, type ProviderId, type Settings } from './model';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { ClaudeExtraUsage } from './ClaudeExtraUsage';
import { Icon } from './icons';
import { UsageHistory } from './UsageHistory';
import { retryCountdown } from './providerState';
import { CLAUDE_LOCAL, LOW_ALLOWANCE_REMAINING, countdown, formatDateTime, formatTime, neutralColors, planLabel, quotaPercent, resetText, short, visibleMetrics } from './format';
import { CodexSubscription } from './CodexSubscription';
import { dayValue } from './coverage';
import { UnofficialBadge, UnofficialNote } from './ProviderNotes';
import { CURSOR_HISTORY_NOTE } from './exportUsage';
import { usageProjection } from './pacing';
import { OverviewCardHeading, type CardFold } from './OverviewCardHeading';

const websites = {
  claude: { status: 'https://status.claude.com/', usage: 'https://claude.ai/settings/usage' },
  codex: { status: 'https://status.openai.com/', usage: 'https://chatgpt.com/settings/usage?tab=overview' },
  cursor: { status: 'https://status.cursor.com/', usage: 'https://cursor.com/dashboard' },
};

export const colors = neutralColors;
const sampleModels = { claude: [['Opus', 62], ['Sonnet', 35], ['Haiku', 3]], codex: [['Codex', 78], ['Codex Mini', 22]], cursor: [['Auto', 72], ['Selected model', 28]] } as const;
export const thirtyDaySpend = (id: ProviderId) => [...dailySpend[id], ...dailySpend[id], ...dailySpend[id]].slice(-30).reduce((sum, value) => sum + value, 0);

export function QuotaMetric({ provider, metric, settings, now }: { provider: Pick<Provider, 'name' | 'cached'>; metric: Metric; settings: Settings; now: number }) {
  const remaining = Math.max(0, 100 - Math.min(100, metric.usedPercent));
  const value = settings.remaining ? remaining : 100 - remaining;
  const projection = settings.pacing && !provider.cached ? usageProjection(metric, now) : undefined;
  const resetHint = metric.resetAt === null ? undefined : settings.resetStyle === 'absolute' ? countdown(metric.resetAt, now) : formatDateTime(metric.resetAt, settings.timeFormat);
  const reset = resetText(metric, now, settings);
  const description = `${quotaPercent(value)}% ${settings.remaining ? 'left' : 'used'}. ${reset}${resetHint ? `. ${resetHint}` : ''}${projection ? `. At current pace: ${short(projection.projected)}% used by reset` : ''}`;
  return <div className="quick-metric">
    <div className="quick-metric-title"><h3 title={metric.label}>{metric.label}</h3><i role="img" className={remaining <= 10 ? 'critical' : remaining <= LOW_ALLOWANCE_REMAINING ? 'low' : ''} aria-label={remaining <= 10 ? 'Very little allowance left' : remaining <= LOW_ALLOWANCE_REMAINING ? 'Low allowance' : 'Allowance available'}/></div>
    <div className={`quick-meter${provider.cached ? ' is-cached' : ''}`} role="progressbar" aria-label={`${provider.cached ? 'Cached ' : ''}${provider.name} ${metric.label} ${settings.remaining ? 'remaining' : 'used'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={description} title={description}>
      <span style={{ width: `${value}%` }}/>
      {projection && <i className="quick-pace-marker" aria-hidden="true" style={{left:`${settings.remaining ? 100 - projection.elapsedPercent : projection.elapsedPercent}%`}}/>}
    </div>
    <div className="quick-metric-caption"><span>{quotaPercent(value)}% {settings.remaining ? 'left' : 'used'}</span><span title={resetHint}>{reset}</span></div>
    {projection && <p className={`quick-pace ${projection.spare < 0 ? 'quick-pace-high' : ''}`} title={`${quotaPercent(projection.elapsedPercent)}% of this window has elapsed. Assumes the average usage rate so far continues.`}>At current pace: {short(projection.projected)}% used by reset</p>}
  </div>;
}

function localSummary(provider: Provider) {
  const history = provider.history;
  if (!history?.available) return provider.historyLoading ? 'Reading recorded Claude Code history…' : 'No recorded Claude Code activity found in this local profile yet.';
  const today = dayValue(history, history.days.find(day => day.date === history.today));
  return `Local history only · ${today ? `${short(today.totalTokens)} tokens today` : 'today not recorded'}`;
}

export function QuickProvider({ provider, settings, now, detailed = false, connectionError, reconnect, retry, fold }: { provider: Provider; settings: Settings; now: number; detailed?: boolean; connectionError?: string; reconnect?: () => void; retry?: () => void; fold?: CardFold }) {
  const [linkError, setLinkError] = useState('');
  const needsSignIn = !connectionError || /sign.in|subscription|API.key|official.*CLI/i.test(connectionError);
  const limited = provider.quotaState === 'rate_limited';
  const timedOut = connectionError?.includes('lookup took too long');
  const metrics = visibleMetrics(provider, now);
  const coolingDown = limited && typeof provider.retryAt === 'number' && provider.retryAt > now;
  async function openWebsite(page: 'status' | 'usage') {
    if (!isTauri()) { window.open(websites[provider.id][page], '_blank', 'noopener,noreferrer'); return; }
    try { await invoke('open_provider_page', { providerId: provider.id, page }); }
    catch { setLinkError('The provider page could not be opened.'); }
  }
  return <article className={`quick-provider ${detailed ? 'quick-detail' : fold?.collapsed ? 'is-collapsed' : ''}`}>
    {!detailed && <OverviewCardHeading title={provider.name} label={`${provider.name}${provider.accountLabel ? ` · ${provider.accountLabel}` : ''}`} secondary={<span title={[provider.accountLabel, planLabel(provider)].filter(Boolean).join(' · ')}>{provider.accountLabel ? `${provider.accountLabel} · ` : ''}{planLabel(provider)}{provider.id === 'cursor' && <> <UnofficialBadge/></>}</span>} fold={fold}/>}
    {detailed && <div className="quick-provider-links"><button onClick={() => void openWebsite('status')}>Status <Icon name="external" size={12}/></button><button onClick={() => void openWebsite('usage')}>Usage dashboard <Icon name="external" size={12}/></button></div>}
    {detailed && provider.id === 'cursor' && <UnofficialNote className="quick-info"/>}
    {provider.historyOnly && detailed && <section className="quick-subscription-unknown" aria-label="Claude subscription status"><h2>Subscription status unavailable</h2><p>Local history cannot show whether your plan is active or paused. Check your Claude account in the Usage dashboard.</p></section>}
    {provider.historyOnly && <p className="quick-info quick-local-note">{detailed ? CLAUDE_LOCAL : localSummary(provider)}</p>}
    {!provider.historyOnly && !metrics.length && !detailed && <p className="quick-info">{provider.history?.available ? 'Live allowances unavailable. Open this provider to see recorded device activity.' : 'Live allowances unavailable.'}</p>}
    {!provider.historyOnly && !metrics.length && detailed && <><div className="quick-metrics quick-metrics-unavailable" aria-label="Live quotas unavailable">{(provider.id === 'cursor' ? ['Monthly'] : ['Session', 'Weekly']).map(label => <div className="quick-metric" key={label}><div className="quick-metric-title"><h3>{label}</h3><i className="unavailable" aria-hidden="true"/></div><div className="quick-meter"><span/></div><div className="quick-metric-caption"><span>{limited ? 'Rate limited' : 'Unavailable'}</span><span>Reset unavailable</span></div></div>)}</div><div className="quick-reconnect" role="status"><span title={connectionError}>{limited ? coolingDown ? `Usage paused. Retrying in ${retryCountdown(provider.retryAt!, now)}.` : 'Usage requests are rate limited.' : needsSignIn ? `Renew your ${provider.name} sign-in to see limits.` : timedOut ? 'The usage lookup took too long. Try refreshing again.' : 'Live limits unavailable. Try refreshing.'}</span><button disabled={coolingDown} onClick={!limited && needsSignIn ? reconnect : retry}>{!limited && needsSignIn ? 'Connect' : coolingDown ? 'Waiting' : 'Retry'}</button></div></>}
    {provider.cached && metrics.length > 0 && <div className="quick-reconnect quick-cache-notice" role="status"><span>{limited && 'Usage checks are rate limited. '}Cached quotas from {formatTime(provider.fetchedAt!, settings.timeFormat)}{coolingDown ? `. Retrying automatically in ${retryCountdown(provider.retryAt!, now)}` : limited ? '. Retrying automatically' : '. Refresh unavailable'}.</span></div>}
    {metrics.length > 0 && <div className="quick-metrics">{(detailed ? metrics.slice(0, 2) : metrics).map(metric => <QuotaMetric key={metric.label} provider={provider} metric={metric} settings={settings} now={now}/>)}</div>}
    {provider.id === 'claude' && !settings.demo && <ClaudeExtraUsage provider={provider} now={now}/>}
    {detailed && metrics.length > 2 && <details className="quick-more-limits"><summary>More limits ({metrics.length - 2})</summary>{metrics.slice(2).map(metric => <QuotaMetric key={metric.label} provider={provider} metric={metric} settings={settings} now={now}/>)}</details>}
    {!settings.demo && provider.id === 'claude' && !provider.cached && metrics.length > 0 && provider.fetchedAt != null && <p className="quick-detail-caption" title={formatDateTime(provider.fetchedAt, settings.timeFormat)}>Last checked {formatTime(provider.fetchedAt, settings.timeFormat)}</p>}
    {detailed && provider.id === 'codex' && !settings.demo && <CodexSubscription provider={provider} settings={settings}/>}
    {detailed && <>{settings.demo ? <><section className="quick-statistics" aria-label={`${provider.name} sample spending`}><dl>{(['Today', 'Yesterday', 'Last 30 days'] as const).map((label, index) => <div key={label}><dt>{label}</dt><dd>{money(index === 0 ? provider.spendToday! : index === 1 ? dailySpend[provider.id].at(-2)! : thirtyDaySpend(provider.id))}</dd></div>)}</dl></section><section className="quick-inline-trend"><h3>Usage trend</h3><div className="quick-sparkbars" role="img" aria-label={`${provider.name} simulated spending over 14 days`}>{dailySpend[provider.id].map((value, index, values) => <i key={index} style={{ height: `${Math.max(5, value / Math.max(...values) * 100)}%` }}/>)}</div></section><section className="quick-models"><dl>{sampleModels[provider.id].map(([model, percentage]) => <div key={model}><dt>{model}</dt><dd>{percentage}%</dd></div>)}</dl><p className="quick-sample-note">Illustrative · sample data</p></section></> : provider.tokenOnly ? <p className="quick-info quick-history-note">Connected with an account token. Subscription limits come from the provider; local history and sign-in files are not read.</p> : provider.history?.available ? <UsageHistory history={provider.history} providerId={provider.id} timeFormat={settings.timeFormat}/> : provider.id === 'cursor' ? <p className="quick-info quick-history-note">{CURSOR_HISTORY_NOTE}</p> : <section className="quick-statistics"><dl>{['Today', 'Yesterday', `Last ${settings.historyDays} days`].map(label => <div key={label}><dt>{label}</dt><dd>Unavailable</dd></div>)}</dl><p className="quick-info">{provider.historyLoading ? 'Reading recorded local usage…' : connectionError?.includes('history could not be read') ? 'Recorded local history could not be read. Try refreshing.' : 'No recorded activity found in this local profile.'}</p></section>}
    </>}
    {linkError && <p role="status" className="quick-info">{linkError}</p>}
  </article>;
}
