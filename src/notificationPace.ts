import { notificationMeterKey, type NotificationReading, type PaceEpisode } from './notificationPolicy';
import { notificationIdentity } from './notificationIdentity';

export const NOTIFICATION_PACE = 'meterluma.notification-pace.v1';
interface SavedEpisode extends PaceEpisode { id: string; until: number }

const meterId = (reading: NotificationReading) => notificationIdentity(notificationMeterKey(reading));

function savedEpisodes(now: number): SavedEpisode[] {
  const raw = localStorage.getItem(NOTIFICATION_PACE);
  if (raw === null) return [];
  const saved: SavedEpisode[] = JSON.parse(raw);
  if (!Array.isArray(saved) || saved.length > 512 || saved.some(episode => !episode || typeof episode.id !== 'string' || !/^[a-f0-9]{64}$/.test(episode.id) || ![0, 1, 2].includes(episode.level) || !Number.isFinite(episode.episode) || !Number.isFinite(episode.until) || !Array.isArray(episode.pending) || episode.pending.length > 2 || episode.pending.some(level => level !== 1 && level !== 2))) throw new Error('Notification pace history is invalid.');
  return saved.filter(episode => episode.until > now && episode.until <= now + 367 * 86_400_000 && episode.episode <= now);
}

export async function restoreNotificationPace(readings: NotificationReading[], episodes: Map<string, PaceEpisode>) {
  const saved = savedEpisodes(Date.now());
  await Promise.all(readings.filter(reading => reading.resetAt !== null && !episodes.has(notificationMeterKey(reading))).map(async reading => {
    const id = await meterId(reading);
    const previous = saved.find(episode => episode.id === id);
    if (previous) episodes.set(notificationMeterKey(reading), { level: previous.level, episode: previous.episode, pending: [...new Set(previous.pending)] });
  }));
}

export async function saveNotificationPace(readings: NotificationReading[], episodes: Map<string, PaceEpisode>) {
  const now = Date.now();
  const saved = await Promise.all(readings.filter(reading => reading.resetAt !== null && episodes.has(notificationMeterKey(reading))).map(async reading => ({
    id: await meterId(reading), ...episodes.get(notificationMeterKey(reading))!, until: Math.min(reading.resetAt! + 60_000, now + 366 * 86_400_000),
  })));
  localStorage.setItem(NOTIFICATION_PACE, JSON.stringify(saved));
}
