import type { Provider } from './model';
import type { LiveResult } from './useLiveProviders';
import type { AdditionalResult } from './additional/model';
import { providerNames, visibleMetrics } from './format';

export function trayWarningReasons(core: LiveResult[], additional: AdditionalResult[], selected: Provider | undefined, timing: { now: number; interval: number }) {
  const { now, interval } = timing;
  const reasons = core.flatMap(result => [
    ...(result.error ? [`${providerNames[result.id]}: ${result.quotaFailure ? 'usage lookup failed' : 'history lookup failed'}`] : []),
    ...(result.provider ? visibleMetrics(result.provider, now).filter(metric => metric.usedPercent >= 100).map(metric => `${providerNames[result.id]}: ${metric.label} exhausted`) : []),
  ]);
  for (const result of additional) {
    const name = result.snapshot?.name ?? result.label;
    if (result.error) reasons.push(`${name}: usage lookup failed`);
    if (result.snapshot) {
      reasons.push(...snapshotWarnings(result.snapshot, now, interval).map(reason => `${name}: ${reason}`));
      if (result.snapshot.warning) reasons.push(`${name}: provider reported a warning`);
      // A cached window that has already reset is no longer exhausted, matching core providers.
      reasons.push(...visibleMetrics(result.snapshot, now).filter(metric => metric.usedPercent >= 100).map(metric => `${name}: ${metric.label} exhausted`));
    }
  }
  if (selected) reasons.push(...snapshotWarnings(selected, now, interval).map(reason => `${selected.name}: ${reason}`));
  return [...new Set(reasons)];
}

function snapshotWarnings(snapshot: Pick<Provider, 'cached' | 'fetchedAt' | 'metrics'>, now: number, interval: number) {
  return [
    ...(snapshot.cached ? ['cached usage'] : []),
    ...(snapshot.fetchedAt !== undefined && now < snapshot.fetchedAt ? ['usage timestamp is in the future'] : []),
    ...(snapshot.fetchedAt !== undefined && now - snapshot.fetchedAt > interval * 2 ? ['usage is out of date'] : []),
    ...snapshot.metrics.filter(metric => metric.resetAt !== null && metric.resetAt <= now).map(metric => `${metric.label} reset is due`),
  ];
}
