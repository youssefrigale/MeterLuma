import { isTauri } from '@tauri-apps/api/core';
import type { useUsageNotifications } from './useUsageNotifications';
import type { NotificationPreferences } from './notificationPreferences';

export function NotificationSettings({ notifications }: { notifications: ReturnType<typeof useUsageNotifications> }) {
  const { preferences, permission, busy, error } = notifications;
  const unavailable = !isTauri() || permission === 'unsupported' || permission === 'unavailable' || permission === undefined;
  const state = permission === 'authorized' ? 'Allowed by macOS.' : permission === 'provisional' ? 'macOS allows quiet notifications.' : permission === 'denied' ? 'Blocked in macOS notification settings.' : permission === 'not_determined' ? 'Enable to request permission from macOS.' : permission === undefined ? 'Checking notification settings…' : 'Requires the bundled Mac app in this build.';
  return <section aria-label="Desktop notifications"><h2>Desktop notifications</h2>
    <label className="quick-check"><input type="checkbox" checked={preferences.enabled} disabled={busy || unavailable && !preferences.enabled} onChange={() => void notifications.toggle()}/>Send usage notifications</label>
    <p>{state} Notices include the provider, quota name and event, without account labels. macOS Focus and notification preferences control whether they appear.</p>
    {preferences.enabled && <>
      {([['low', 'Under 10% allowance left'], ['thresholds', 'Custom usage-alert thresholds'], ['pace', 'Pace gets close to or exceeds the limit']] as const).map(([key, label]) => <label key={key} className="quick-check"><input type="checkbox" checked={preferences[key]} disabled={busy} onChange={() => notifications.change({ [key]: !preferences[key] })}/>{label}</label>)}
      <div className="feature-form"><label>Remind me before reset<select aria-label="Notification reset reminder" value={preferences.resetMinutes} disabled={busy} onChange={event => notifications.change({ resetMinutes: Number(event.target.value) as NotificationPreferences['resetMinutes'] })}>{[[0, 'Off'], [10, '10 minutes'], [60, '1 hour'], [720, '12 hours'], [1440, '24 hours']].map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}</select></label></div>
      <p>Uses fresh live quotas while MeterLuma runs. Pace alerts need a known window and at least 5% elapsed; the first reading sets a baseline that survives restart. Up to three quotas share one notification per minute. Failed requests are not replayed automatically.</p>
    </>}
    {error && <p role="status">{error}</p>}
    {permission === 'denied' && <><p>In System Settings, choose Notifications → MeterLuma, then return here to check again.</p><button className="quick-text-button" disabled={busy} onClick={() => void notifications.openSettings()}>Open System Settings</button></>}
    {isTauri() && <button className="quick-text-button" disabled={busy} onClick={() => void notifications.readPermission()}>Check notification settings again</button>}
    {isTauri() && <details><summary>Notification history</summary><p>Stores up to 1,000 hashed event identifiers with expiry times, plus up to 512 coarse pace states. Clearing them allows current low-allowance, threshold and reset alerts to be requested again.</p><button className="quick-text-button" disabled={busy} onClick={notifications.clearHistory}>Clear notification history</button></details>}
  </section>;
}
