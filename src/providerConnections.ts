import type { ProviderId, Settings } from './model';

export interface ProviderConnection { id: ProviderId; key: string; directory: string | null; label?: string; tokenMode: boolean }

export function providerConnections(settings: Settings): ProviderConnection[] {
  const tokens = settings.tokenProviders ?? [];
  return [
    ...settings.liveProviders.filter(id => settings.enabled.includes(id)).map(id => ({ id, key: tokens.includes(id) ? `token-${id}` : id, directory: null, tokenMode: tokens.includes(id), label: tokens.includes(id) ? 'Account token' : settings.profiles.some(row => row.providerId === id) ? 'Default profile' : undefined })),
    ...settings.profiles.filter(row => !row.paused && settings.enabled.includes(row.providerId) && !tokens.includes(row.providerId)).map(row => ({ id: row.providerId, key: row.key, directory: row.directory, label: row.label, tokenMode: false })),
  ];
}
