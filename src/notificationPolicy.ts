import type { Metric, Provider, Settings } from './model';
import type { AdditionalResult } from './additional/model';
import { additionalConnections, additionalProvider } from './additional/model';
import { providerConnections } from './providerConnections';
import { alertFreshness } from './Alerts';
import { hasClaudeUsageConsent } from './legal';
import { notificationPreferences } from './notificationPreferences';
import { usageProjection } from './pacing';

export interface NotificationReading extends Metric { providerId: string; connection: string; fetchedAt: number }
export type NoticeKind = 'low' | 'threshold' | 'pace_close' | 'pace_risk' | 'reset';
export interface NoticeCandidate {
  key: string; meter: string; providerId: string; metricLabel: string; kind: NoticeKind; until: number;
}
export interface PaceEpisode { level: number; episode: number; pending: number[] }

function fresh(fetchedAt: number | undefined, now: number, refreshMinutes: number) {
  return typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt <= now && now - fetchedAt <= alertFreshness(refreshMinutes);
}

export function notificationReadings(settings: Settings, core: Provider[], additional: AdditionalResult[], now: number): NotificationReading[] {
  const readings: NotificationReading[] = [];
  const chosenCore = new Set(providerConnections(settings).map(connection => JSON.stringify([connection.id, connection.key])));
  const chosenAdditional = new Set(additionalConnections(settings.additionalConnections).filter(connection => connection.enabled !== false && additionalProvider(connection.id)?.state === 'ready').map(connection => connection.id));
  for (const provider of core) {
    if (!chosenCore.has(JSON.stringify([provider.id, provider.connectionKey ?? provider.id])) || provider.id === 'claude' && !hasClaudeUsageConsent(settings) || provider.cached || provider.historyOnly || provider.quotaState && provider.quotaState !== 'live' || !fresh(provider.fetchedAt, now, settings.refreshMinutes)) continue;
    readings.push(...provider.metrics.map(metric => ({ ...metric, providerId: provider.id, connection: provider.connectionKey ?? provider.id, fetchedAt: provider.fetchedAt! })));
  }
  for (const connection of additional) {
    const snapshot = connection.snapshot;
    if (!chosenAdditional.has(connection.id) || !snapshot || snapshot.cached || snapshot.warning || connection.error || !fresh(snapshot.fetchedAt, now, settings.refreshMinutes)) continue;
    readings.push(...snapshot.metrics.map(metric => ({ ...metric, providerId: connection.id, connection: `additional:${connection.id}`, fetchedAt: snapshot.fetchedAt })));
  }
  return readings.filter(reading => Number.isFinite(reading.usedPercent) && reading.usedPercent >= 0 && reading.label.trim().length > 0 && reading.label.length <= 64 && !/[\u0000-\u001f\u007f]/.test(reading.label) && (reading.resetAt === null || Number.isFinite(reading.resetAt) && reading.resetAt > now)).slice(0, 512);
}

export function notificationMeterKey(reading: NotificationReading) {
  return JSON.stringify([reading.providerId, reading.connection, reading.label, reading.resetAt === null ? null : Math.round(reading.resetAt / 60_000)]);
}

function candidate(reading: NotificationReading, kind: NoticeKind, suffix: string, now: number): NoticeCandidate {
  const meter = notificationMeterKey(reading);
  return { meter, key: `${kind}:${suffix}:${meter}`, providerId: reading.providerId, metricLabel: reading.label, kind, until: Math.min(reading.resetAt === null ? now + 86_400_000 : reading.resetAt + 60_000, now + 366 * 86_400_000) };
}

function paceCandidates(reading: NotificationReading, now: number, episodes: Map<string, PaceEpisode>) {
  const projection = reading.usedPercent < 100 ? usageProjection(reading, now) : undefined;
  if (!projection || projection.elapsedPercent < 5) return [];
  const level = projection.projected > 100 ? 2 : projection.projected >= 90 ? 1 : 0;
  const key = notificationMeterKey(reading); const previous = episodes.get(key);
  if (!previous || level === 0) { episodes.set(key, { level, episode: previous?.level === 0 ? previous.episode : now, pending: [] }); return []; }
  if (level > previous.level && !previous.pending.includes(level)) previous.pending.push(level);
  previous.level = level;
  return previous.pending.filter(pending => pending <= level).map(pending => candidate(reading, pending === 2 ? 'pace_risk' : 'pace_close', String(previous.episode), now));
}

export function notificationCandidates(settings: Settings, readings: NotificationReading[], now: number, episodes: Map<string, PaceEpisode>) {
  const preferences = notificationPreferences(settings.notifications);
  const activeMeters = new Set(readings.map(notificationMeterKey));
  for (const key of episodes.keys()) if (!activeMeters.has(key)) episodes.delete(key);
  return readings.flatMap(reading => {
    const notices: NoticeCandidate[] = [];
    if (preferences.low && reading.usedPercent > 90 && reading.usedPercent < 100) notices.push(candidate(reading, 'low', '', now));
    if (preferences.thresholds) for (const rule of settings.alerts.filter(rule => rule.enabled && rule.providerId === reading.providerId && reading.usedPercent >= rule.threshold)) notices.push(candidate(reading, 'threshold', `${rule.key}:${rule.threshold}`, now));
    if (preferences.pace) notices.push(...paceCandidates(reading, now, episodes));
    if (preferences.resetMinutes && reading.resetAt !== null && reading.usedPercent < 100 && reading.resetAt - now <= preferences.resetMinutes * 60_000) notices.push(candidate(reading, 'reset', String(preferences.resetMinutes), now));
    return notices;
  });
}
