import { additionalCatalog } from './additional/model';

export const defaultAdditionalOrder = [...additionalCatalog].sort((left, right) => left.name.localeCompare(right.name)).map(provider => provider.id);

export function additionalProviderOrder(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  return [...new Set(saved.filter((id): id is string => typeof id === 'string' && defaultAdditionalOrder.includes(id)))].slice(0, defaultAdditionalOrder.length);
}

export function orderedAdditional<T extends { id: string }>(providers: readonly T[], saved: readonly string[] = []): T[] {
  const ids = [...saved, ...defaultAdditionalOrder.filter(id => !saved.includes(id))];
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...providers].sort((left, right) => (positions.get(left.id) ?? ids.length) - (positions.get(right.id) ?? ids.length));
}

export function moveProvider<T extends string>(order: readonly T[], source: T, target: T): T[] {
  const from = order.indexOf(source); const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order]; next.splice(from, 1); next.splice(to, 0, source); return next;
}
