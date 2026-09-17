import type { Appointment } from '@borradh-workspace/database';
import type { DepositStatus } from '@borradh-workspace/labels';
import { appointmentStatusValues } from '@borradh-workspace/labels';

// Re-export database type
export type { Appointment };

// Appointment status enum values — single source of truth is
// @borradh-workspace/labels (appointmentStatusLabels)
export const APPOINTMENT_STATUSES = appointmentStatusValues;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// Appointment source enum values
export const APPOINTMENT_SOURCES = [
  'manual',
  'ai_voice_caller',
  'calendar_sync',
] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

// Appointment color enum values
export const APPOINTMENT_COLORS = [
  'blue',
  'green',
  'red',
  'yellow',
  'purple',
  'orange',
] as const;
export type AppointmentColor = (typeof APPOINTMENT_COLORS)[number];

// Appointment with relations
export interface AppointmentWithRelations extends Appointment {
  lead?: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    metadata?: Record<string, unknown> | null;
    formData?: Record<string, unknown> | null;
  };
  /**
   * NULLABLE, not merely optional.
   *
   * `appointment.assignedToId` is `onDelete: 'set null'` by design — removing a
   * staff member must not cascade-delete their historical appointments — so
   * Drizzle's `with: { assignedTo: … }` returns `null` for every appointment
   * of a departed staff member. Typed `?:` only, every such row was a lie.
   *
   * This shape is declared in THREE places that must agree: here, the runtime
   * schema `appointmentWithRelationsSchema` in `@borradh-workspace/contracts`,
   * and `AppointmentWithRelations` in api-client (which derives from this one).
   * All three said non-null; a real row with a real NULL, exercised in
   * `apps/api/src/_integration/tool-appointments.int-spec.ts`, said otherwise.
   */
  assignedTo?: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
  service?: {
    id: string;
    name: string;
    priceText: string | null;
    appointmentDuration: number | null;
  } | null;
  /**
   * The effective deposit for this appointment, if any. When multiple deposit
   * rows exist over time (e.g. an expired attempt then a fresh one), this is the
   * paid one if present, else the most recent. Null when no deposit was ever
   * requested.
   */
  deposit?: {
    status: DepositStatus;
    amountCents: number;
    currency: string;
    paidAt: Date | null;
  } | null;
}
