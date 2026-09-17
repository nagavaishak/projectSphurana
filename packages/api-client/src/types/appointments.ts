/**
 * @borradh-workspace/api-client - Appointment API Types
 *
 * Types for the appointments API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 *
 * Following type-sharing pattern: .claude/rules/_patterns/type-sharing.md
 * - Response types use Serialize<T> (Date → string)
 * - Input types use Serialize<T> since JSON sends dates as ISO strings
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  AppointmentColor,
  AppointmentSource,
  AppointmentStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  appointmentColorLabels,
  appointmentColorValues,
  appointmentSourceLabels,
  appointmentSourceValues,
  appointmentStatusLabels,
  appointmentStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend types from features
import type {
  Appointment as BackendAppointment,
  AppointmentWithRelations as BackendAppointmentWithRelations,
  CreateAppointmentInput as BackendCreateAppointmentInput,
  ListAppointmentsInput as BackendListAppointmentsInput,
  UpdateAppointmentInput as BackendUpdateAppointmentInput,
} from '@borradh-workspace/features/appointments';

import type { PartialBy, Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Appointment status type - re-exported from database
 */
export type { AppointmentStatus };

/**
 * Appointment source type - re-exported from database
 */
export type { AppointmentSource };

/**
 * Appointment color type - re-exported from database
 */
export type { AppointmentColor };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  appointmentStatusLabels,
  appointmentStatusValues,
  appointmentSourceLabels,
  appointmentSourceValues,
  appointmentColorLabels,
  appointmentColorValues,
};

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Appointment entity type (API response - dates serialized to ISO strings)
 */
export type Appointment = Serialize<BackendAppointment>;

/**
 * Appointment with relations (lead, assigned user)
 */
export type AppointmentWithRelations =
  Serialize<BackendAppointmentWithRelations>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List response for appointments
 * Uses AppointmentWithRelations as the backend includes lead and assignedTo relations
 */
export interface AppointmentListResponse {
  items: AppointmentWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, serialized for JSON transport
// ============================================================================

/**
 * Input for creating a new appointment
 * - Serialized: Date → string (JSON sends ISO strings)
 * - Omits organizationId (added by controller from session)
 * - assignedToId made optional (controller defaults to session user)
 */
export type CreateAppointmentInput = PartialBy<
  Serialize<Omit<BackendCreateAppointmentInput, 'organizationId'>>,
  'assignedToId'
>;

/**
 * Input for updating an appointment
 * - Serialized: Date → string (JSON sends ISO strings)
 * - Omits organizationId (from session)
 * - id included for hook convenience (passed via route param)
 */
export type UpdateAppointmentInput = Serialize<
  Omit<BackendUpdateAppointmentInput, 'organizationId'>
>;

/**
 * Parameters for listing appointments
 * - Serialized: Date → string (JSON sends ISO strings)
 * - Omits organizationId (added by controller from session)
 * - Note: Hook accepts Date objects and converts to ISO strings
 */
export type ListAppointmentsParams = Serialize<
  Omit<BackendListAppointmentsInput, 'organizationId'>
>;
