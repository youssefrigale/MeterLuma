import type { LiveResult } from './useLiveProviders';
import { costRangeCoverage, estimatedValue, type CostRange } from './coverage';
import { providerNames, short } from './format';

export function costRow(connection: LiveResult, range: CostRange) {
  const history = connection.provider?.history;
  const estimate = estimatedValue(history, range);
  const recorded = history?.available ? costRangeCoverage(history, range) : undefined;
  const tokens = recorded && recorded.recorded.length > 0 ? `${short(recorded.total)} recorded tokens` : undefined;
  return {
    id: connection.id, key: connection.key,
    name: `${providerNames[connection.id]}${connection.label ? ` · ${connection.label}` : ''}`,
    cost: estimate?.cost ?? null, unpriced: estimate?.unpriced ?? 0, label: estimate?.label ?? '',
    status: estimate ? 'Priced' : tokens ? 'Not priced' : connection.historyLoading ? 'Reading…' : 'Unavailable',
    note: estimate ? undefined : tokens ?? (connection.historyLoading ? 'Reading recorded usage…' : connection.error?.includes('history could not be read') ? 'Recorded local history could not be read. Try refreshing.' : 'No recorded token history for this period.'),
  };
}
