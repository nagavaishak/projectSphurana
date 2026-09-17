/**
 * Appointment types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Entity and enum types
export type {
  Appointment,
  AppointmentWithRelations,
  AppointmentStatus,
  AppointmentSource,
  AppointmentColor,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsParams,
} from '@borradh-workspace/api-client/types';

// Response types
export type { AppointmentListResponse } from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  appointmentStatusLabels,
  appointmentStatusValues,
  appointmentSourceLabels,
  appointmentSourceValues,
  appointmentColorLabels,
  appointmentColorValues,
} from '@borradh-workspace/api-client/types';
