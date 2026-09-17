import type {
  PractitionerId,
  UserId,
} from '@borradh-workspace/features/shared';

import type { AppointmentColor, AppointmentStatus } from '../types';
import type { UpdateAppointmentIntent } from './update-appointment.input';

/**
 * Structural view of a calendar event the update flow reads from. Kept
 * dependency-free (no `IEvent` import) so the appointments API layer doesn't
 * couple to the calendar component tree — the calendar's `IEvent` is assignable
 * to this shape.
 *
 * INVARIANT (enforced by the reassignment surfaces — edit dialog + mobile
 * sheet): `user.id` is the owning org-member USER id (assignedToId), and
 * `metadata.practitionerId` is the PRACTITIONER (staff) id. Keeping them in
 * their own slots is what lets us route each to the correctly-branded field.
 */
export interface CalendarEventUpdateSource {
  id: string | number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  /** Calendar tint (`TEventColor`). Only appointment colors reach this path. */
  color: string;
  user: { id: string };
  metadata?: Record<string, unknown>;
}

/** Options carried out of the reschedule-confirm dialog. */
export interface RescheduleOptions {
  sendRescheduleEmail?: boolean;
  rescheduleMessage?: string;
}

/**
 * THE single place a calendar event is turned into an update INTENT (drag /
 * resize, the desktop edit dialog and the mobile booking sheet all reach the
 * API through here → the hook → {@link buildUpdateAppointmentPayload}). Because
 * the intent is branded, `user.id` can only feed `assignedToId` (a `UserId`)
 * and `metadata.practitionerId` can only feed `practitionerId` (a
 * `PractitionerId`) — a practitioner id can never be written into the user FK.
 */
export function updateIntentFromCalendarEvent(
  event: CalendarEventUpdateSource,
  options?: RescheduleOptions
): UpdateAppointmentIntent {
  const status =
    typeof event.metadata?.status === 'string'
      ? (event.metadata.status as AppointmentStatus)
      : undefined;

  const practitionerId =
    typeof event.metadata?.practitionerId === 'string' &&
    event.metadata.practitionerId.length > 0
      ? (event.metadata.practitionerId as PractitionerId)
      : undefined;

  return {
    id: String(event.id),
    title: event.title,
    description: event.description || null,
    startDate: event.startDate,
    endDate: event.endDate,
    color: event.color as AppointmentColor,
    assignedToId: event.user.id ? (event.user.id as UserId) : null,
    ...(practitionerId !== undefined && { practitionerId }),
    ...(status !== undefined && { status }),
    ...(options?.sendRescheduleEmail !== undefined && {
      sendRescheduleEmail: options.sendRescheduleEmail,
    }),
    ...(options?.rescheduleMessage !== undefined && {
      rescheduleMessage: options.rescheduleMessage,
    }),
  };
}
