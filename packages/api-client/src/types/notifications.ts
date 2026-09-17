/**
 * @borradh-workspace/api-client - Notifications API Types
 *
 * Types for the notifications feed + preferences API endpoints.
 * Types are derived from backend packages - never import from
 * @borradh-workspace/database directly, only from features/shared.
 *
 * See: .claude/rules/_patterns/type-sharing.md
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  Notification as BackendNotification,
  NotificationPreference as BackendNotificationPreference,
  NotificationCategory,
  NotificationChannels,
  NotificationPreferencesData,
  NotificationScope,
  NotificationType,
  ScopedCategoryPreference,
  ToggleCategoryPreference,
} from '@borradh-workspace/features/shared';

// Import labels, values and helpers from features/shared (runtime values)
import {
  defaultNotificationPreferences,
  notificationCategoryLabels,
  notificationScopeLabels,
  notificationScopeValues,
  notificationTypeLabels,
  notificationTypeValues,
  withPreferenceDefaults,
} from '@borradh-workspace/features/shared';

// Import backend input types from features (type-only - safe for browser bundles)
import type { UpdateNotificationPreferencesInput as BackendUpdateNotificationPreferencesInput } from '@borradh-workspace/features/notification-preferences';

// Import utility types
import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM / DATA TYPES - Re-exported from features/shared (Labels pattern)
// ============================================================================

export type {
  NotificationType,
  NotificationScope,
  NotificationCategory,
  NotificationChannels,
  NotificationPreferencesData,
  ScopedCategoryPreference,
  ToggleCategoryPreference,
};

// Re-export labels, values and helpers for frontend use (dropdowns, defaults)
export {
  notificationTypeLabels,
  notificationTypeValues,
  notificationScopeLabels,
  notificationScopeValues,
  notificationCategoryLabels,
  defaultNotificationPreferences,
  withPreferenceDefaults,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses
// ============================================================================

/**
 * Notification entity (API response - dates serialized to ISO strings)
 */
export type Notification = Serialize<BackendNotification>;

/**
 * Notification preferences entity (API response - dates serialized to ISO strings)
 */
export type NotificationPreferences = Serialize<BackendNotificationPreference>;

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for updating notification preferences.
 * Omits userId (added by controller from session).
 */
export type UpdateNotificationPreferencesInput = Omit<
  BackendUpdateNotificationPreferencesInput,
  'userId'
>;

/**
 * Query params for listing notifications.
 */
export interface ListNotificationsParams {
  limit?: number;
  offset?: number;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Response for listing notifications.
 */
export interface ListNotificationsResponse {
  items: Notification[];
  total: number;
}

/**
 * Response for the unread notification count endpoint.
 */
export interface UnreadNotificationCountResponse {
  count: number;
}

/**
 * Response for the mark-all-read endpoint.
 */
export interface MarkAllNotificationsReadResponse {
  updated: number;
}
