// Recorded-history coverage. Days before coverageStart have no local logs; they are not zero-usage days.
import type { UsageDay, UsageHistory } from './model';
import { formatDay } from './format';

export interface Coverage {
  start: string | null; shorter: boolean; recorded: UsageDay[]; isRecorded: (date: string) => boolean;
  total: number; unpriced: number; cost?: number; priced: boolean; label: string;
}

export function coverage(history: UsageHistory, days: UsageDay[] = history.days): Coverage {
  // Older native builds did not report coverage; treat their whole window as recorded.
  const start = history.coverageStart === undefined ? history.days[0]?.date ?? null : history.coverageStart;
  const isRecorded = (date: string) => start !== null && date >= start;
  const recorded = days.filter(day => isRecorded(day.date));
  const shorter = start !== null && !!days[0] && start > days[0].date;
  const total = recorded.reduce((sum, day) => sum + day.totalTokens, 0);
  const unpriced = recorded.reduce((sum, day) => sum + (day.unpricedTokens ?? 0), 0);
  const cost = recorded.length && recorded.every(day => typeof day.estimatedCostUsd === 'number') ? recorded.reduce((sum, day) => sum + day.estimatedCostUsd!, 0) : undefined;
  const priced = recorded.some(day => day.totalTokens > (day.unpricedTokens ?? 0) && typeof day.estimatedCostUsd === 'number');
  const label = start === null ? `Last ${days.length} days` : shorter ? `Since ${formatDay(start)}` : `Last ${days.length} days`;
  return { start, shorter, recorded, isRecorded, total, unpriced, cost, priced, label };
}

export type CostRange = 'Today' | 'Yesterday' | '30 Days';
// API-value estimate (priced tokens at standard rates) for one range; undefined when no priced history exists.
export function estimatedValue(history: UsageHistory | undefined, range: CostRange) {
  if (!history?.available || !coverage(history).priced) return undefined;
  const value = coverage(history, range === 'Today' ? history.days.filter(day => day.date === history.today) : range === 'Yesterday' ? history.days.slice(-2, -1) : history.days.slice(-30));
  return value.cost === undefined ? undefined : { cost: value.cost, unpriced: value.unpriced, label: value.label, shorter: value.shorter };
}

export function dayValue(history: UsageHistory, day: UsageDay | undefined) {
  if (!day) return undefined;
  const start = history.coverageStart === undefined ? history.days[0]?.date ?? null : history.coverageStart;
  return start !== null && day.date >= start ? day : null;
}
