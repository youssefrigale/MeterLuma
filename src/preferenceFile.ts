import { settingsFromValue, type Settings } from './model';
import { APP_VERSION } from './format';

const fields = ['theme', 'remaining', 'refreshMinutes', 'enabled', 'resetStyle', 'timeFormat', 'providerOrder', 'historyDays', 'pacing', 'compactOverview', 'trayMetric'] as const;
export type DisplayPreferences = Pick<Settings, typeof fields[number]>;

export function displayPreferences(settings: Settings): DisplayPreferences {
  const normalized = settingsFromValue(settings);
  return Object.fromEntries(fields.map(field => [field, normalized[field]])) as DisplayPreferences;
}

export function preferenceFile(settings: Settings) {
  return JSON.stringify({ kind: 'MeterLumaPreferences', formatVersion: 1, appVersion: APP_VERSION, preferences: displayPreferences(settings) }, null, 2);
}

export function parsePreferenceFile(text: string): DisplayPreferences {
  // Empty/oversized documents, wrong versions, extra keys and coerced values must not alter settings.
  if (!text.length || new TextEncoder().encode(text).length > 65_536) throw new Error('Invalid preference file size.');
  const document: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!document || typeof document !== 'object' || !('kind' in document) || document.kind !== 'MeterLumaPreferences' || !('formatVersion' in document) || document.formatVersion !== 1 || !('preferences' in document)) throw new Error('Unsupported preference file.');
  const preferences = document.preferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences) || Object.keys(preferences).length !== fields.length || Object.keys(preferences).some(field => !fields.includes(field as typeof fields[number]))) throw new Error('Unsupported preference fields.');
  const normalized = displayPreferences(settingsFromValue(preferences));
  if (fields.some(field => JSON.stringify(preferences[field as keyof typeof preferences]) !== JSON.stringify(normalized[field]))) throw new Error('Invalid preference values.');
  return normalized;
}

export function preferenceChanges(current: Settings, imported: DisplayPreferences) {
  const previous = displayPreferences(current);
  return fields.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(imported[field]));
}

export const preferenceNames: Record<keyof DisplayPreferences, string> = {
  theme: 'Appearance', remaining: 'Usage mode', refreshMinutes: 'Refresh interval', enabled: 'Provider visibility', resetStyle: 'Reset timers', timeFormat: 'Time format', providerOrder: 'Provider order', historyDays: 'History window', pacing: 'Usage projection', compactOverview: 'Overview spacing', trayMetric: 'Menu bar allowance',
};
