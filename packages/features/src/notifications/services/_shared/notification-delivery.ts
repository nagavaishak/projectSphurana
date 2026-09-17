import type {
  NotificationCategory,
  NotificationPreferencesData,
  NotificationType,
} from '@borradh-workspace/labels';

/** Maps each notification type to the preference category that gates it. */
export const notificationTypeCategory: Record<
  NotificationType,
  NotificationCategory
> = {
  appointment_booked: 'appointments',
  appointment_rescheduled: 'appointments',
  appointment_cancelled: 'appointments',
  chatbot_handoff: 'inbox',
  ad_rejected: 'advertising',
  lead_created: 'leads',
  shop_order_received: 'orders',
};

/** Extra channels (beyond the always-on in-app feed) for one recipient. */
export interface DeliveryDecision {
  email: boolean;
  push: boolean;
}

export interface ResolveDeliveryInput {
  preferences: NotificationPreferencesData;
  type: NotificationType;
  /** Whether this candidate is the user the event "belongs to". */
  isAssignee: boolean;
}

/**
 * Decides whether a candidate recipient should receive a notification of this
 * type, and through which extra channels. Returns `null` when they should NOT
 * receive it at all. When non-null, the in-app feed row is always created.
 */
export const resolveNotificationDelivery = (
  input: ResolveDeliveryInput
): DeliveryDecision | null => {
  const { preferences, type, isAssignee } = input;
  const category = notificationTypeCategory[type];

  if (category === 'advertising') {
    const pref = preferences.advertising;
    if (!pref.enabled) return null;
    return { email: pref.channels.email, push: pref.channels.push };
  }

  // Scoped categories: appointments | inbox | leads | orders.
  const pref = preferences[category];
  if (pref.scope === 'off') return null;
  if (pref.scope === 'mine' && !isAssignee) return null;
  // scope 'all', or scope 'mine' && isAssignee.
  return { email: pref.channels.email, push: pref.channels.push };
};
