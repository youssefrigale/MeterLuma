import type { Metric } from './model';

// Earlier in a window the average rate is too noisy to project; notifications use the same rule.
export const PACE_MIN_ELAPSED_PERCENT = 5;
export const PACE_DISPLAY_LIMIT = 200;

export function usageProjection(metric: Metric, now: number) {
  if (metric.resetAt === null || !metric.periodMinutes || !Number.isFinite(metric.periodMinutes) || metric.periodMinutes <= 0 || metric.periodMinutes > 525600) return undefined;
  const duration = metric.periodMinutes * 60_000;
  const elapsed = now - (metric.resetAt - duration);
  if (elapsed < 60_000 || elapsed >= duration || !Number.isFinite(metric.usedPercent) || metric.usedPercent < 0) return undefined;
  const elapsedPercent = elapsed / duration * 100;
  if (elapsedPercent < PACE_MIN_ELAPSED_PERCENT) return undefined;
  const projected = metric.usedPercent / elapsedPercent * 100;
  if (!Number.isFinite(projected)) return undefined;
  return { elapsedPercent, projected, spare: 100 - projected };
}

export function selectTrayMetric(metrics: Metric[], selection: 'session' | 'weekly' | 'lowest' = 'session') {
  if (selection === 'lowest') return metrics.reduce<Metric | undefined>((lowest, metric) => !lowest || metric.usedPercent > lowest.usedPercent ? metric : lowest, undefined);
  return metrics.find(metric => selection === 'weekly' ? /weekly/i.test(metric.label) : metric.label === 'Session') ?? metrics[0];
}
