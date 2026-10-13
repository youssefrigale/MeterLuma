export type ProviderId = 'claude' | 'codex' | 'cursor';
export type Theme = 'dark' | 'light' | 'system';
export interface Settings {
  theme: Theme;
  demo: boolean;
  remaining: boolean;
  refreshMinutes: number;
  enabled: ProviderId[];
}
export interface Metric { label: string; usedPercent: number; resetAt: number }
export interface Provider {
  id: ProviderId;
  name: string;
  plan: string;
  color: string;
  initials: string;
  spendToday: number;
  metrics: Metric[];
}
export const defaults: Settings = { theme: 'dark', demo: true, remaining: false, refreshMinutes: 5, enabled: ['claude', 'codex', 'cursor'] };
export const SETTINGS_KEY = 'meterluma.settings.v1';
const providerIds: ProviderId[] = ['claude', 'codex', 'cursor'];

export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...defaults };
    const parsed = value as Record<string, unknown>;
    const enabled = parsed.enabled;
    return {
      theme: ['dark', 'light', 'system'].includes(String(parsed.theme)) ? parsed.theme as Theme : defaults.theme,
      demo: typeof parsed.demo === 'boolean' ? parsed.demo : defaults.demo,
      remaining: typeof parsed.remaining === 'boolean' ? parsed.remaining : defaults.remaining,
      refreshMinutes: [1, 5, 15].includes(Number(parsed.refreshMinutes)) ? Number(parsed.refreshMinutes) : defaults.refreshMinutes,
      enabled: Array.isArray(enabled) ? providerIds.filter(id => enabled.includes(id)) : [...defaults.enabled],
    };
  } catch { return { ...defaults }; }
}

export function sampleProviders(anchor: number): Provider[] {
  const hour = 3_600_000;
  return [
    { id: 'claude', name: 'Claude', plan: 'Max', color: '#dca18b', initials: '✳', spendToday: 4.26, metrics: [
      { label: 'Session', usedPercent: 38, resetAt: anchor + 2.22 * hour },
      { label: 'Weekly', usedPercent: 64, resetAt: anchor + 78 * hour },
    ] },
    { id: 'codex', name: 'Codex', plan: 'Pro', color: '#9dcbb8', initials: '⌘', spendToday: 3.14, metrics: [
      { label: 'Session', usedPercent: 22, resetAt: anchor + 3.65 * hour },
      { label: 'Weekly', usedPercent: 47, resetAt: anchor + 102 * hour },
    ] },
    { id: 'cursor', name: 'Cursor', plan: 'Pro', color: '#b8b7df', initials: '↗', spendToday: 1.02, metrics: [
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
export function countdown(resetAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((resetAt - now) / 60_000));
  if (!minutes) return 'Reset due';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours ? `${hours}h ` : ''}${minutes % 60}m`;
}
