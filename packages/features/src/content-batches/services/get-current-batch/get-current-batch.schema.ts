import { z } from 'zod';

export const getCurrentBatchSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  // Optional override for the month — defaults to the current UTC month.
  // The Socials page never passes this; tests and admin tooling do.
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must be YYYY-MM')
    .optional(),
});

export type GetCurrentBatchInput = z.infer<typeof getCurrentBatchSchema>;
