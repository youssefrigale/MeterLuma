export interface NotificationPreferences {
  enabled: boolean;
  low: boolean;
  thresholds: boolean;
  pace: boolean;
  resetMinutes: 0 | 10 | 60 | 720 | 1440;
}

export function notificationPreferences(saved: unknown): NotificationPreferences {
  const preferences = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  return {
    enabled: preferences.enabled === true,
    low: preferences.low !== false,
    thresholds: preferences.thresholds !== false,
    pace: preferences.pace === true,
    resetMinutes: [10, 60, 720, 1440].includes(Number(preferences.resetMinutes)) && typeof preferences.resetMinutes === 'number' ? preferences.resetMinutes as NotificationPreferences['resetMinutes'] : 0,
  };
}
