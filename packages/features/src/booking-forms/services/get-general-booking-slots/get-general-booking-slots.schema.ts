import { z } from 'zod';

export const getGeneralBookingSlotsSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  practitionerId: z.string().optional(),
  // Optional per-branch slug. Absent = the org's DEFAULT branch, which is what
  // this endpoint effectively did before branches existed.
  //
  // This is the PUBLIC addressing mode and the only one the HTTP DTO exposes
  // (`GetGeneralBookingSlotsDto`): a URL names a branch by slug.
  locationSlug: z.string().min(1).optional(),
  // The INTERNAL addressing mode, for a server-side caller that already holds
  // the branch's row — today that is `rescheduleManagedAppointment`, whose
  // "is this slot really on offer?" gate must be drawn from the branch the
  // appointment is ALREADY stamped with, not from a branch a client named.
  //
  // It exists because slug and id are not interchangeable here.
  // `organization_location.slug` is still nullable and the backfill has not
  // run, so a perfectly valid branch may have no slug at all — and the one
  // caller that must never guess is exactly the one guarding against a
  // cross-branch move. `location_id` is always there, so the write gate keys
  // on that and never needs a slug.
  locationId: z.string().min(1).optional(),
});

export type GetGeneralBookingSlotsInput = z.infer<
  typeof getGeneralBookingSlotsSchema
>;
