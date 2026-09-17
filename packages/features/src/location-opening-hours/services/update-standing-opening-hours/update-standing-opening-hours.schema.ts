import { z } from 'zod';
import { openingHoursSchema } from '../../models/index.js';

export const updateStandingOpeningHoursSchema = z.object({
  organizationId: z.string().min(1),
  locationId: z.string().min(1),
  /**
   * Pass null to clear and inherit org.businessHours; otherwise the new
   * weekly schedule. Day keys are stringified (0..6); use minutes from
   * midnight for from/to.
   */
  openingHours: openingHoursSchema.nullable(),
});

export type UpdateStandingOpeningHoursInput = z.infer<
  typeof updateStandingOpeningHoursSchema
>;
