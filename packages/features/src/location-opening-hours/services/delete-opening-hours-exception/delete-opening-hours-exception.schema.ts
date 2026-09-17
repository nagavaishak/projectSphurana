import { z } from 'zod';

export const deleteOpeningHoursExceptionSchema = z.object({
  organizationId: z.string().min(1),
  locationId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

export type DeleteOpeningHoursExceptionInput = z.infer<
  typeof deleteOpeningHoursExceptionSchema
>;
