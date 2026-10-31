import { additionalProvider } from './additional/model';

export function overviewCardKeys(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  // Only opaque connection IDs belong here: never copy account labels or directory paths into layout keys.
  return [...new Set(saved.filter((key): key is string => typeof key === 'string' && !/[\u0000-\u001f\u007f]/.test(key) && (
    /^core:(claude|codex|cursor):[a-zA-Z0-9_-]{1,80}$/.test(key)
    || /^additional:[a-z0-9-]{1,80}$/.test(key) && additionalProvider(key.slice('additional:'.length))?.state === 'ready'
  )))].slice(-80);
}

export function toggleExpandedCard(keys: string[], key: string) {
  return keys.includes(key) ? keys.filter(previous => previous !== key) : [...keys, key].slice(-80);
}
