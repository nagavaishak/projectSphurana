import { z } from 'zod';

export const deleteShiftOverrideSchema = z.object({
  organizationId: z.string().min(1),
  practitionerId: z.string().min(1),
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export type DeleteShiftOverrideInput = z.infer<
  typeof deleteShiftOverrideSchema
>;
