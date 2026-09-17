/**
 * Notification enums and preference shape - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Notification type labels
export const notificationTypeLabels = {
  appointment_booked: 'Appointment booked',
  appointment_rescheduled: 'Appointment rescheduled',
  appointment_cancelled: 'Appointment cancelled',
  chatbot_handoff: 'Conversation needs you',
  ad_rejected: 'Ad rejected',
  lead_created: 'New lead',
  shop_order_received: 'New online order',
} as const;

export const notificationTypeValues = Object.keys(notificationTypeLabels) as [
  keyof typeof notificationTypeLabels,
  ...(keyof typeof notificationTypeLabels)[],
];

export type NotificationType = keyof typeof notificationTypeLabels;

// --- Notification preference shape (persisted as a JSON column) ---

// Scope controls whose events a user is notified about.
export const notificationScopeLabels = {
  mine: 'Only mine',
  all: 'Everyone',
  off: 'Off',
} as const;

export const notificationScopeValues = Object.keys(notificationScopeLabels) as [
  keyof typeof notificationScopeLabels,
  ...(keyof typeof notificationScopeLabels)[],
];

export type NotificationScope = keyof typeof notificationScopeLabels;

// Notification preference categories — the JSON keys.
export const notificationCategoryLabels = {
  appointments: 'Appointments',
  inbox: 'Inbox handoffs',
  advertising: 'Ad rejections',
  leads: 'New leads',
  orders: 'Orders',
} as const;

export type NotificationCategory = keyof typeof notificationCategoryLabels;

// Per-category delivery channels. The in-app feed is always on when an event
// passes scope/enabled — these only gate the extra reach.
export interface NotificationChannels {
  email: boolean;
  push: boolean;
}

// Categories with a "mine / all / off" axis (events tied to a specific user).
export interface ScopedCategoryPreference {
  scope: NotificationScope;
  channels: NotificationChannels;
}

// Categories that are org-wide (no "mine") — just on/off.
export interface ToggleCategoryPreference {
  enabled: boolean;
  channels: NotificationChannels;
}

export interface NotificationPreferencesData {
  appointments: ScopedCategoryPreference;
  inbox: ScopedCategoryPreference;
  advertising: ToggleCategoryPreference;
  leads: ScopedCategoryPreference;
  /** Online orders are operational work for the whole clinic. */
  orders: ScopedCategoryPreference;
}

// Applied to every new notification_preference row and merged over partial
// JSON on read, so adding a category later never needs a migration.
export const defaultNotificationPreferences: NotificationPreferencesData = {
  appointments: { scope: 'mine', channels: { email: true, push: true } },
  inbox: { scope: 'mine', channels: { email: true, push: true } },
  advertising: { enabled: true, channels: { email: true, push: true } },
  // Defaults to 'all' because most leads arrive unowned (Meta instant forms,
  // chatbot), so 'mine' would silently notify nobody in the common case.
  // Email is off — lead email notifications are deliberately out of scope.
  leads: { scope: 'all', channels: { email: false, push: true } },
  // An online order needs attention before the customer arrives, so it is the
  // one category deliberately defaulting to both channels for everyone.
  orders: { scope: 'all', channels: { email: true, push: true } },
};

/**
 * Merges stored (possibly partial or older-shape) preference JSON over the
 * current defaults, so a row written before a new category existed still
 * yields a complete object — no migration needed when the shape grows.
 */
export const withPreferenceDefaults = (
  stored: Partial<NotificationPreferencesData> | null | undefined
): NotificationPreferencesData => {
  const d = defaultNotificationPreferences;
  return {
    appointments: {
      scope: stored?.appointments?.scope ?? d.appointments.scope,
      channels: {
        email:
          stored?.appointments?.channels?.email ??
          d.appointments.channels.email,
        push:
          stored?.appointments?.channels?.push ?? d.appointments.channels.push,
      },
    },
    inbox: {
      scope: stored?.inbox?.scope ?? d.inbox.scope,
      channels: {
        email: stored?.inbox?.channels?.email ?? d.inbox.channels.email,
        push: stored?.inbox?.channels?.push ?? d.inbox.channels.push,
      },
    },
    advertising: {
      enabled: stored?.advertising?.enabled ?? d.advertising.enabled,
      channels: {
        email:
          stored?.advertising?.channels?.email ?? d.advertising.channels.email,
        push:
          stored?.advertising?.channels?.push ?? d.advertising.channels.push,
      },
    },
    leads: {
      scope: stored?.leads?.scope ?? d.leads.scope,
      channels: {
        email: stored?.leads?.channels?.email ?? d.leads.channels.email,
        push: stored?.leads?.channels?.push ?? d.leads.channels.push,
      },
    },
    orders: {
      scope: stored?.orders?.scope ?? d.orders.scope,
      channels: {
        email: stored?.orders?.channels?.email ?? d.orders.channels.email,
        push: stored?.orders?.channels?.push ?? d.orders.channels.push,
      },
    },
  };
};
