import { venueAmenityValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const updateLocationVenueSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // The location (venue) being edited. Validated to belong to the active org.
  locationId: z.string().min(1, 'Location ID is required'),
  // Freeform "about the venue" copy shown on the public page. Nullable clears it.
  about: z.string().nullable().optional(),
  // Amenities are validated against the canonical label keys; unknown keys are
  // rejected rather than silently stored.
  amenities: z.array(z.enum(venueAmenityValues)).optional(),
  // Per-branch URL slug. Nullable clears it; a duplicate collides on the unique
  // constraint and surfaces as ALREADY_EXISTS.
  slug: z.string().min(1).nullable().optional(),
});

export type UpdateLocationVenueInput = z.infer<
  typeof updateLocationVenueSchema
>;
