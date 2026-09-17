import { z } from 'zod';

export const listPractitionersSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  isActive: z
    .preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean()
    )
    .optional(),
  /**
   * Restrict to practitioners a STAFF member may book a client in with —
   * active, not soft-deleted, and not sitting on an unaccepted invitation
   * (ENG-794).
   *
   * Opt-IN rather than the default, because this endpoint feeds two very
   * different kinds of surface. Team management and the shift roster must keep
   * SHOWING invitees (that is where you see the "Invited" badge, and where
   * pre-configuring their hours is a legitimate thing to do); the calendar
   * columns and the appointment practitioner picker must not OFFER them.
   */
  bookable: z
    .preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean()
    )
    .optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. Zero
   * `practitioner_location` rows means "works at every branch", which is the
   * state of every practitioner that predates branch assignment.
   */
  locationId: z.string().min(1).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type ListPractitionersInput = z.infer<typeof listPractitionersSchema>;
