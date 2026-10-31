import { invoke } from '@tauri-apps/api/core';
import type { NoticeCandidate, NoticeKind } from './notificationPolicy';
import { notificationIdentity } from './notificationIdentity';

export const NOTIFICATION_HISTORY = 'meterluma.notification-history.v1';
interface Receipt { id: string; until: number }
export interface NotificationHistory { receipts: Receipt[]; lastQueued: number }
const priority: Record<NoticeKind, number> = { low: 5, pace_risk: 4, threshold: 3, reset: 2, pace_close: 1 };

export function notificationHistory(now: number): NotificationHistory {
  const raw = localStorage.getItem(NOTIFICATION_HISTORY);
  if (raw === null) return { receipts: [], lastQueued: 0 };
  const history: unknown = JSON.parse(raw);
  if (!history || typeof history !== 'object' || !('receipts' in history) || !Array.isArray(history.receipts) || history.receipts.length > 1000 || !('lastQueued' in history) || typeof history.lastQueued !== 'number' || !Number.isFinite(history.lastQueued)) throw new Error('Notification history is invalid.');
  const receipts: Receipt[] = history.receipts;
  if (receipts.some(receipt => !receipt || typeof receipt.id !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.id) || typeof receipt.until !== 'number' || !Number.isFinite(receipt.until))) throw new Error('Notification history is invalid.');
  return { receipts: receipts.filter(receipt => receipt.until > now && receipt.until <= now + 367 * 86_400_000).map(receipt => ({ id: receipt.id, until: receipt.until })), lastQueued: history.lastQueued };
}

async function hashedCandidate(notice: NoticeCandidate) {
  return { ...notice, id: await notificationIdentity(notice.key) };
}

export async function deliverUsageNotices(candidates: NoticeCandidate[], permitted: () => boolean) {
  const now = Date.now(); const history = notificationHistory(now);
  // One grouped request per minute; sleep/reopen catches up without replaying a burst of notifications.
  if (now >= history.lastQueued && now - history.lastQueued < 60_000) return false;
  const seen = new Set(history.receipts.map(receipt => receipt.id));
  const pending = (await Promise.all(candidates.map(hashedCandidate))).filter(notice => !seen.has(notice.id)).sort((left, right) => priority[right.kind] - priority[left.kind]);
  const grouped: typeof pending = []; const meters = new Set<string>();
  for (const notice of pending) {
    if (meters.has(notice.meter)) continue;
    grouped.push(notice); meters.add(notice.meter);
    if (grouped.length === 3) break;
  }
  if (!grouped.length || !permitted()) return false;
  // Reserve attempts before dispatch: a crash or uncertain OS reply must not replay the same alert.
  history.receipts = [...history.receipts, ...pending.filter(notice => meters.has(notice.meter)).map(notice => ({ id: notice.id, until: notice.until }))].slice(-1000);
  history.lastQueued = now;
  localStorage.setItem(NOTIFICATION_HISTORY, JSON.stringify(history));
  await invoke('queue_usage_notification', { notices: grouped.map(notice => ({ id: notice.id, providerId: notice.providerId, metricLabel: notice.metricLabel, kind: notice.kind })) });
  return true;
}
