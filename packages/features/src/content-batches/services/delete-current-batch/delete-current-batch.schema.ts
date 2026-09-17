import { z } from 'zod';

export const deleteCurrentBatchSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  // Optional override for the month — defaults to the current UTC month.
  // Mirrors getCurrentBatch so the reset hits the same row the planner shows.
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must be YYYY-MM')
    .optional(),
});

export type DeleteCurrentBatchInput = z.infer<typeof deleteCurrentBatchSchema>;
