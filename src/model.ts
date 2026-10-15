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
export interface UsageDay { date: string; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd?: number | null; unpricedTokens?: number }
export interface UsageHistory { periodDays?: number; available: boolean; partial: boolean; recordCount: number; scannedAt: number; today: string; coverageStart?: string | null; days: UsageDay[]; models: { name: string; totalTokens: number }[] }
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
  // Claude is shown from recorded local history only; it never has live quotas.
  historyOnly?: boolean;
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
      // Claude has no quotas, so earlier Claude alert rules could never fire again and are dropped.
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.filter((row): row is AlertRule => !!row && typeof row === 'object' && typeof row.key === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(row.key) && providerIds.includes(row.providerId) && row.providerId !== 'claude' && typeof row.threshold === 'number' && Number.isFinite(row.threshold) && row.threshold >= 1 && row.threshold <= 100 && typeof row.enabled === 'boolean').filter((row, index, rows) => rows.findIndex(other => other.key === row.key) === index).slice(0, 12) : [],
      providerOrder: Array.isArray(parsed.providerOrder) ? [...new Set(parsed.providerOrder.filter((id): id is ProviderId => providerIds.includes(id as ProviderId))), ...providerIds.filter(id => !(parsed.providerOrder as unknown[]).includes(id))] : [...providerIds],
    };
  } catch { return { ...defaults }; }
}

// Resets display preferences only. Consent, connections, local accounts and alerts are kept.
export function resetPreferences(current: Settings): Settings {
  return { ...defaults, enabled: [...defaults.enabled], providerOrder: [...defaults.providerOrder], legalVersion: current.legalVersion, liveProviders: current.liveProviders, profiles: current.profiles, alerts: current.alerts };
}

export const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
function sampleHistory(anchor: number): UsageHistory {
  const days = dailySpend.claude.map((spend, index) => { const date = new Date(anchor); date.setDate(date.getDate() - 13 + index); const total = Math.round(spend * 240_000); return { date: localDate(date), inputTokens: Math.round(total * .9), cachedInputTokens: Math.round(total * .7), cacheWriteTokens: 0, outputTokens: total - Math.round(total * .9), totalTokens: total, estimatedCostUsd: spend, unpricedTokens: 0 }; });
  return { available: true, partial: false, recordCount: 14, scannedAt: anchor, today: days[13].date, coverageStart: days[0].date, periodDays: 14, days, models: [{ name: 'Sample model A', totalTokens: Math.round(days.reduce((sum, day) => sum + day.totalTokens, 0) * .7) }, { name: 'Sample model B', totalTokens: Math.round(days.reduce((sum, day) => sum + day.totalTokens, 0) * .3) }] };
}

export function sampleProviders(anchor: number): Provider[] {
  const hour = 3_600_000;
  return [
    { id: 'claude', name: 'Claude', plan: 'Local history', color: '#515157', initials: '', spendToday: 4.26, historyOnly: true, metrics: [], history: sampleHistory(anchor) },
    { id: 'codex', name: 'Codex', plan: 'Pro', color: '#85858c', initials: '', spendToday: 3.14, metrics: [
      { label: 'Session', usedPercent: 22, resetAt: anchor + 3.65 * hour },
      { label: 'Weekly', usedPercent: 47, resetAt: anchor + 102 * hour },
    ] },
    { id: 'cursor', name: 'Cursor', plan: 'Pro', color: '#b8b8bf', initials: '', spendToday: 1.02, metrics: [
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
export { countdown } from './format';
