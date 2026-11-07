// Pure display helpers. No import.meta here, so Node-side tests can import this module.
import type { Metric, Provider, ProviderId, Settings } from './model';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const LOW_ALLOWANCE_REMAINING = 25;
export const providerNames: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };
// Neutral grays only; provider brand colors are never shown.
export const neutralColors: Record<ProviderId, string> = { claude: '#515157', codex: '#85858c', cursor: '#b8b8bf' };
export const NOT_AFFILIATED = 'MeterLuma is not affiliated with or endorsed by Anthropic, OpenAI or Anysphere (Cursor).';
export const CURSOR_UNOFFICIAL = 'Uses an undocumented Cursor endpoint that is not endorsed by Cursor and may change or stop working without notice.';
export const CLAUDE_LOCAL = "MeterLuma reads token counts from Claude Code's local logs. It does not read the Claude sign-in or contact Anthropic.";
export const CLAUDE_LIVE = 'MeterLuma reads the access token from Claude Code’s macOS Keychain entry or the selected profile’s credential file and sends it only to api.anthropic.com. Tokens stay out of settings, logs and exports. On macOS, MeterLuma starts Claude Code automatically when access expires so it can renew your sign-in. No prompt is sent; Claude Code manages token rotation and storage.';

export function planLabel(provider: Pick<Provider, 'id' | 'plan'>): string {
  if (provider.id !== 'codex') return provider.plan;
  const labels: Record<string, string> = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro 5x', promax: 'Pro Max', team: 'Team', business: 'Business', self_serve_business_prolite: 'Business Premium', enterprise: 'Enterprise', edu: 'Edu', unknown: 'Subscription' };
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
export function quotaPercent(value: number) {
  if (value > 0 && value < 0.1) return '<0.1';
  if (value > 99.9 && value < 100) return '>99.9';
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export const remainingPercent = (usedPercent: number) => Math.min(100, Math.max(0, 100 - usedPercent));
// The native menu-bar title takes a whole number. Like quotaPercent, it never shows 0 while
// allowance remains or 100 once any of it is used.
export function wholeRemainingPercent(usedPercent: number) {
  const remaining = remainingPercent(usedPercent);
  return remaining > 0 && remaining < 100 ? Math.min(99, Math.max(1, Math.round(remaining))) : remaining;
}

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
export function visibleMetrics(provider: Pick<Provider, 'cached' | 'fetchedAt' | 'metrics'>, now: number) {
  return provider.cached ? provider.metrics.filter(metric => metric.resetAt === null ? now - (provider.fetchedAt ?? 0) <= 300_000 : metric.resetAt > now) : provider.metrics;
}
