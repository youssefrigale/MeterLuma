export type ProviderId = 'claude' | 'codex' | 'cursor';
// Sample data is a developer preview; release builds always use real-data mode.
export const DEMO_AVAILABLE = import.meta.env.DEV;
export type Theme = 'dark' | 'light' | 'system';
export type HistoryDays = 30 | 90 | 365;
export interface AccountProfile { key: string; providerId: ProviderId; label: string; directory: string }
export interface AlertRule { key: string; providerId: ProviderId; threshold: number; enabled: boolean }
export interface Settings {
  theme: Theme;
  demo: boolean;
  remaining: boolean;
  refreshMinutes: number;
  enabled: ProviderId[];
  liveProviders: ProviderId[];
  resetStyle: 'relative' | 'absolute';
  timeFormat: 'auto' | '12' | '24';
  providerOrder: ProviderId[];
  historyDays: HistoryDays;
  profiles: AccountProfile[];
  alerts: AlertRule[];
  legalVersion: string;
}
export interface Metric { label: string; usedPercent: number; resetAt: number | null }
export interface UsageDay { date: string; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd?: number | null }
export interface UsageHistory { periodDays?: number; available: boolean; partial: boolean; recordCount: number; scannedAt: number; today: string; days: UsageDay[]; models: { name: string; totalTokens: number }[] }
export interface Provider {
  id: ProviderId;
  name: string;
  plan: string;
  color: string;
  initials: string;
  spendToday: number | null;
  metrics: Metric[];
  connectionKey?: string;
  accountLabel?: string;
  fetchedAt?: number;
  history?: UsageHistory;
  historyLoading?: boolean;
  quotaState?: import('./providerState').QuotaState;
  retryAt?: number;
  cached?: boolean;
}
export const defaults: Settings = { theme: 'system', demo: false, remaining: true, refreshMinutes: 5, enabled: ['claude', 'codex', 'cursor'], liveProviders: [], resetStyle: 'relative', timeFormat: 'auto', providerOrder: ['claude', 'codex', 'cursor'], historyDays: 30, profiles: [], alerts: [], legalVersion: '' };
export const SETTINGS_KEY = 'meterluma.settings.v2';
const providerIds: ProviderId[] = ['claude', 'codex', 'cursor'];

export function readSettings(): Settings {
  try {
    const current = localStorage.getItem(SETTINGS_KEY);
    const raw = current ?? localStorage.getItem('meterluma.settings.v1');
    if (!raw) return { ...defaults };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...defaults };
    const parsed = value as Record<string, unknown>;
    const enabled = parsed.enabled;
    const liveProviders = parsed.liveProviders;
    return {
      theme: ['dark', 'light', 'system'].includes(String(parsed.theme)) ? parsed.theme as Theme : defaults.theme,
      // Older prototypes opened with fabricated previews. Migration always starts in real-data mode.
      demo: DEMO_AVAILABLE && current && typeof parsed.demo === 'boolean' ? parsed.demo : false,
      remaining: typeof parsed.remaining === 'boolean' ? parsed.remaining : defaults.remaining,
      refreshMinutes: [1, 5, 15, 30, 60].includes(Number(parsed.refreshMinutes)) ? Number(parsed.refreshMinutes) : defaults.refreshMinutes,
      enabled: Array.isArray(enabled) ? providerIds.filter(id => enabled.includes(id)) : [...defaults.enabled],
      liveProviders: Array.isArray(liveProviders) ? providerIds.filter(id => liveProviders.includes(id)) : [],
      resetStyle: parsed.resetStyle === 'absolute' ? 'absolute' : 'relative',
      timeFormat: parsed.timeFormat === '12' || parsed.timeFormat === '24' ? parsed.timeFormat : 'auto',
      historyDays: parsed.historyDays === 90 || parsed.historyDays === 365 ? parsed.historyDays : 30,
      legalVersion: typeof parsed.legalVersion === 'string' ? parsed.legalVersion : '',
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles.filter((row): row is AccountProfile => !!row && typeof row === 'object' && typeof row.key === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(row.key) && providerIds.includes(row.providerId) && typeof row.label === 'string' && row.label.trim().length > 0 && row.label.length <= 60 && typeof row.directory === 'string' && row.directory.trim().length > 0 && row.directory.length <= 1024).filter((row, index, rows) => rows.findIndex(other => other.key === row.key) === index).slice(0, 12) : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.filter((row): row is AlertRule => !!row && typeof row === 'object' && typeof row.key === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(row.key) && providerIds.includes(row.providerId) && typeof row.threshold === 'number' && Number.isFinite(row.threshold) && row.threshold >= 1 && row.threshold <= 100 && typeof row.enabled === 'boolean').filter((row, index, rows) => rows.findIndex(other => other.key === row.key) === index).slice(0, 12) : [],
      providerOrder: Array.isArray(parsed.providerOrder) ? [...new Set(parsed.providerOrder.filter((id): id is ProviderId => providerIds.includes(id as ProviderId))), ...providerIds.filter(id => !(parsed.providerOrder as unknown[]).includes(id))] : [...providerIds],
    };
  } catch { return { ...defaults }; }
}

export function sampleProviders(anchor: number): Provider[] {
  const hour = 3_600_000;
  return [
    { id: 'claude', name: 'Claude', plan: 'Max', color: '#515157', initials: '✳', spendToday: 4.26, metrics: [
      { label: 'Session', usedPercent: 38, resetAt: anchor + 2.22 * hour },
      { label: 'Weekly', usedPercent: 64, resetAt: anchor + 78 * hour },
    ] },
    { id: 'codex', name: 'Codex', plan: 'Pro', color: '#85858c', initials: '⌘', spendToday: 3.14, metrics: [
      { label: 'Session', usedPercent: 22, resetAt: anchor + 3.65 * hour },
      { label: 'Weekly', usedPercent: 47, resetAt: anchor + 102 * hour },
    ] },
    { id: 'cursor', name: 'Cursor', plan: 'Pro', color: '#b8b8bf', initials: '↗', spendToday: 1.02, metrics: [
      { label: 'Monthly', usedPercent: 76, resetAt: anchor + 264 * hour },
    ] },
  ];
}

export const dailySpend: Record<ProviderId, number[]> = {
  claude: [2.1, 2.9, 1.5, 3.7, 2.6, 4.3, 3.1, 1.7, 3.7, 2.9, 4.1, 3.3, 2.4, 4.26],
  codex: [1.4, 2.1, 1.2, 2.5, 2.9, 2.2, 1.5, 2.5, 1.6, 2.8, 1.8, 2.2, 2.7, 3.14],
  cursor: [0.4, 0.6, 0.8, 0.6, 1.0, 0.8, 1.1, 0.4, 0.9, 0.7, 1.1, 0.5, 0.8, 1.02],
};
export function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value); }
export function countdown(resetAt: number | null, now: number): string {
  if (resetAt === null) return 'Reset time unavailable';
  const minutes = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  if (!minutes) return 'Reset due';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours ? `${hours}h ` : ''}${minutes % 60}m`;
}
