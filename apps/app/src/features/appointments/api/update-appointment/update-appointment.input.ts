import type {
  PractitionerId,
  UserId,
} from '@borradh-workspace/features/shared';

import type { AppointmentColor, AppointmentStatus } from '../types';

/**
 * INTENT for updating an appointment — the typed shape every surface passes to
 * `useUpdateAppointment`. It is NOT the wire body; the ONE builder
 * (`buildUpdateAppointmentPayload`) turns this intent into the `PUT
 * appointments/:id` body. Components pass intent, never an assembled payload,
 * so no two surfaces can build the body differently (drift).
 *
 * The two assignment fields are BRANDED. `assignedToId` is the owning
 * org-member **user** id (`UserId`); `practitionerId` is the **practitioner**
 * (staff) id (`PractitionerId`). A `PractitionerId` is not assignable to
 * `assignedToId`, so the historical id-crossing bug — a practitioner id written
 * into the user FK — can no longer compile.
 *
 * Every field except `id` is optional: the backend applies PATCH semantics, so
 * an omitted field is left untouched (NOT nulled). Pass `null` to clear a
 * nullable column; omit the key to leave it alone.
 */
export interface UpdateAppointmentIntent {
  /** Route param — where the PUT goes; never part of the body. */
  id: string;
  title?: string;
  /** `null` clears the note; omit to leave it. */
  description?: string | null;
  /** ISO instant (already resolved to a real UTC time). */
  startDate?: string;
  /** ISO instant (already resolved to a real UTC time). */
  endDate?: string;
  color?: AppointmentColor;
  status?: AppointmentStatus;
  leadId?: string;
  serviceId?: string | null;
  /** Owning org-member user id. A `PractitionerId` will not type-check here. */
  assignedToId?: UserId | null;
  /** The practitioner (staff) the booking is assigned to. */
  practitionerId?: PractitionerId | null;
  calendarAccountId?: string | null;
  externalCalendarEventId?: string | null;
  sendRescheduleEmail?: boolean;
  rescheduleMessage?: string;
}
