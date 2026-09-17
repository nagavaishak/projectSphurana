import { z } from 'zod';

export const listAppointmentResourcesSchema = z.object({
  organizationId: z.string().min(1),
  /** Window start (inclusive). */
  from: z.coerce.date(),
  /** Window end (exclusive). */
  to: z.coerce.date(),
  /**
   * Branch to scope the feed to. Absent = every branch (the org-wide view).
   * A resource with no location of its own is available everywhere, so it is
   * included whatever branch is asked for.
   */
  locationId: z.string().min(1).optional(),
});

export type ListAppointmentResourcesInput = z.input<
  typeof listAppointmentResourcesSchema
>;
