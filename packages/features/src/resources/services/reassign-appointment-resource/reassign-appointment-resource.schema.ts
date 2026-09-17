import { z } from 'zod';

export const reassignAppointmentResourceSchema = z.object({
  organizationId: z.string().min(1),
  appointmentId: z.string().min(1),
  /** The requirement slot being changed — an appointment holds one per category. */
  categoryId: z.string().min(1),
  /**
   * The resource to move the booking into, or `null` to UNASSIGN — release the
   * category's hold entirely.
   *
   * Unassign has to exist for the same reason assign does: the front desk can
   * put a booking in the wrong room, and a hold with no way back would block
   * that room for the rest of the day with nothing in the UI able to free it.
   */
  resourceId: z.string().min(1).nullable(),
  /**
   * Staff override. Without it a clash is refused with CONFLICT; with it the
   * hold is written anyway, opted out of `resource_no_overlap` exactly like a
   * warn-don't-block console booking.
   */
  force: z.boolean().optional().default(false),
});

export type ReassignAppointmentResourceInput = z.input<
  typeof reassignAppointmentResourceSchema
>;
