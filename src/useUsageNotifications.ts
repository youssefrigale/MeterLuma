import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Provider, Settings } from './model';
import type { AdditionalResult } from './additional/model';
import { hasProviderConsent } from './legal';
import { notificationPreferences, type NotificationPreferences } from './notificationPreferences';
import { notificationCandidates, notificationReadings, type PaceEpisode } from './notificationPolicy';
import { deliverUsageNotices, NOTIFICATION_HISTORY } from './notificationDelivery';
import { restoreNotificationPace, saveNotificationPace, NOTIFICATION_PACE } from './notificationPace';

export type NotificationPermission = 'not_determined' | 'denied' | 'authorized' | 'provisional' | 'unsupported' | 'unavailable';
const allowed = (permission: NotificationPermission | undefined) => permission === 'authorized' || permission === 'provisional';

export function useUsageNotifications(options: { settings: Settings; providers: Provider[]; additional: AdditionalResult[]; remember: (preferences: NotificationPreferences) => boolean }) {
  const [permission, setPermission] = useState<NotificationPermission>();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const episodes = useRef(new Map<string, PaceEpisode>());
  const pending = useRef(false);
  const mounted = useRef(false);
  const inspected = useRef(false);
  const dispatchLatest = useRef<(() => void) | undefined>(undefined);
  const latest = useRef({ ...options, permission }); latest.current = { ...options, permission };
  const preferences = notificationPreferences(options.settings.notifications);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function remember(preferences: NotificationPreferences) {
    if (!latest.current.remember(preferences)) setError('Notification preferences could not be saved. Try again.');
  }
  async function readPermission() {
    setBusy(true); setError('');
    try { setPermission(await invoke<NotificationPermission>('notification_permission')); }
    catch { setPermission(undefined); setError('macOS notification settings could not be read. Try checking again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (inspected.current) return;
    inspected.current = true;
    if (isTauri()) void readPermission();
  }, []);
  async function toggle() {
    if (busy) return;
    const current = notificationPreferences(latest.current.settings.notifications);
    if (current.enabled) { remember({ ...current, enabled: false }); setError(''); return; }
    setBusy(true); setError('');
    try {
      const actual = allowed(permission) ? permission : await invoke<NotificationPermission>('request_notification_permission');
      setPermission(actual);
      if (allowed(actual)) remember({ ...notificationPreferences(latest.current.settings.notifications), enabled: true });
      else setError('Notifications are not allowed. Enable MeterLuma in macOS notification settings, then check again.');
    } catch { setError('Notification permission could not be requested. Check macOS and try again.'); }
    finally { setBusy(false); }
  }
  function permitted() {
    const current = latest.current;
    return isTauri() && notificationPreferences(current.settings.notifications).enabled && hasProviderConsent(current.settings) && !current.settings.demo && allowed(current.permission);
  }
  const signature = JSON.stringify([notificationReadings(options.settings, options.providers, options.additional, Date.now()), preferences, options.settings.alerts, permission, error, options.settings.demo, hasProviderConsent(options.settings)]);
  useEffect(() => {
    if (!permitted() || error) return;
    let active = true;
    async function dispatch() {
      if (!active || pending.current || !permitted()) return;
      pending.current = true; setSending(true);
      const current = latest.current; const now = Date.now();
      try {
        const readings = notificationReadings(current.settings, current.providers, current.additional, now);
        if (notificationPreferences(current.settings.notifications).pace) await restoreNotificationPace(readings, episodes.current);
        if (!active || !permitted()) return;
        const candidates = notificationCandidates(current.settings, readings, now, episodes.current);
        if (notificationPreferences(current.settings.notifications).pace) await saveNotificationPace(readings, episodes.current);
        await deliverUsageNotices(candidates, () => active && permitted());
      }
      catch (reason) { if (mounted.current && notificationPreferences(latest.current.settings.notifications).enabled) setError(typeof reason === 'string' ? `${reason} Notifications paused; clear history to retry failed alerts.` : 'Notification history could not be read or saved. Notifications paused; free space or clear history, then retry.'); }
      finally { pending.current = false; if (mounted.current) setSending(false); if (!active) dispatchLatest.current?.(); }
    }
    dispatchLatest.current = () => { void dispatch(); };
    void dispatch(); const timer = window.setInterval(() => void dispatch(), 30_000);
    return () => { active = false; dispatchLatest.current = undefined; window.clearInterval(timer); };
  }, [signature]);
  function clearHistory() {
    if (pending.current) return;
    try { localStorage.removeItem(NOTIFICATION_HISTORY); localStorage.removeItem(NOTIFICATION_PACE); episodes.current.clear(); setError(''); void readPermission(); }
    catch { setError('Notification history could not be cleared. Check available storage and try again.'); }
  }
  async function openSettings() {
    try { await invoke('open_notification_settings'); }
    catch { setError('System Settings could not be opened. Open it from the Apple menu, then choose Notifications → MeterLuma.'); }
  }
  return { preferences, permission, busy: busy || sending, error, toggle, readPermission, clearHistory, openSettings, change: (update: Partial<NotificationPreferences>) => remember({ ...notificationPreferences(latest.current.settings.notifications), ...update }) };
}
