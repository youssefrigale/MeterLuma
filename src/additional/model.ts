import catalog from './catalog.json';
import type { Metric } from '../model';

export const additionalCatalog = catalog;
export const additionalProvider = (id: string) => additionalCatalog.find(provider => provider.id === id);
export interface AdditionalConnection { id: string; label: string; consentVersion: 1; enabled?: boolean }
export interface AdditionalAmount { label: string; value: number; currency: string | null; unit: string }
export interface AdditionalSnapshot { id: string; name: string; plan: string | null; metrics: Metric[]; amounts: AdditionalAmount[]; fetchedAt: number; cached: boolean; notice: string | null; warning?: boolean }
export interface AdditionalResult { id: string; label: string; snapshot?: AdditionalSnapshot; loading?: boolean; error?: string; retryAt?: number }

export function additionalConnections(raw: unknown): AdditionalConnection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((connection): connection is AdditionalConnection => !!connection && typeof connection === 'object' && typeof connection.id === 'string' && !!additionalProvider(connection.id) && connection.consentVersion === 1 && typeof connection.label === 'string' && connection.label.trim().length > 0 && connection.label.length <= 60 && !/[\x00-\x1f\x7f]/.test(connection.label))
    .filter((connection, index, connections) => connections.findIndex(other => other.id === connection.id) === index).slice(0, 64)
    .map(connection => ({ id: connection.id, label: connection.label.trim(), consentVersion: 1, enabled: connection.enabled !== false }));
}
