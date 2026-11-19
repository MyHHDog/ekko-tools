export interface NotificationSettings {
  enabled: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  mutedAccountIds: string[];
}

export const defaultNotifications: NotificationSettings = {
  enabled: true,
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '08:00',
  mutedAccountIds: []
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeNotifications(value: unknown): NotificationSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const mutedAccountIds = Array.isArray(source.mutedAccountIds)
    ? [...new Set(source.mutedAccountIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64))].slice(0, 100)
    : [];
  return {
    enabled: source.enabled !== false,
    dndEnabled: source.dndEnabled === true,
    dndStart: typeof source.dndStart === 'string' && TIME.test(source.dndStart) ? source.dndStart : defaultNotifications.dndStart,
    dndEnd: typeof source.dndEnd === 'string' && TIME.test(source.dndEnd) ? source.dndEnd : defaultNotifications.dndEnd,
    mutedAccountIds
  };
}

function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

export function inQuietHours(settings: NotificationSettings, now = new Date()) {
  if (!settings.dndEnabled) return false;
  const start = minutes(settings.dndStart), end = minutes(settings.dndEnd);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
