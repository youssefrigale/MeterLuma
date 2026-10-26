// Pure display helpers. No import.meta here, so Node-side tests can import this module.
import type { Metric, Provider, ProviderId, Settings } from './model';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const providerNames: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };
// Neutral grays only; provider brand colors are never shown.
export const neutralColors: Record<ProviderId, string> = { claude: '#515157', codex: '#85858c', cursor: '#b8b8bf' };
export const NOT_AFFILIATED = 'MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor).';
export const CURSOR_UNOFFICIAL = 'Uses an undocumented Cursor endpoint that is not endorsed by Cursor and may change or stop working without notice.';
export const CLAUDE_LOCAL = "MeterLuma reads token counts from Claude Code's local logs. It does not read the Claude sign-in or contact Anthropic.";

export function planLabel(provider: Pick<Provider, 'id' | 'plan'>): string {
  if (provider.id !== 'codex') return provider.plan;
  const labels: Record<string, string> = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro 5x', promax: 'Pro Max', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', unknown: 'Subscription' };
  return labels[provider.plan.toLowerCase()] ?? provider.plan.replaceAll('_', ' ');
}

type TimeFormat = Settings['timeFormat'];
const clock = (timeFormat: TimeFormat): Intl.DateTimeFormatOptions => timeFormat === 'auto' ? {} : { hourCycle: timeFormat === '12' ? 'h12' : 'h23' };
export function formatTime(value: number, timeFormat: TimeFormat) { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...clock(timeFormat) }); }
export function formatDateTime(value: number, timeFormat: TimeFormat) { return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...clock(timeFormat) }); }
// History dates are local calendar days (YYYY-MM-DD); format them without a time-zone shift.
export function formatDay(date: string) { const [year, month, day] = date.split('-').map(Number); return new Date(year, month - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
export const count = (value: number) => value.toLocaleString();
export const short = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

export function countdown(resetAt: number | null, now: number): string {
  if (resetAt === null) return 'Reset time unavailable';
  const minutes = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  if (!minutes) return 'Reset due';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours ? `${hours}h ` : ''}${minutes % 60}m`;
}
export function resetText(metric: Metric, now: number, settings: Pick<Settings, 'resetStyle' | 'timeFormat'>) {
  const reset = countdown(metric.resetAt, now);
  if (metric.resetAt === null) return reset;
  if (reset === 'Reset due') return 'Reset due · refresh to update';
  return settings.resetStyle === 'absolute' ? `Resets ${formatDateTime(metric.resetAt, settings.timeFormat)}` : `Resets in ${reset}`;
}
// Cached quota windows that have already reset are no longer meaningful.
export function visibleMetrics(provider: Provider, now: number) {
  return provider.cached ? provider.metrics.filter(metric => metric.resetAt === null ? now - (provider.fetchedAt ?? 0) <= 300_000 : metric.resetAt > now) : provider.metrics;
}
