import { z } from 'zod';

export const getDailySummarySchema = z.object({
  organizationId: z.string().min(1),
  // Calendar date, YYYY-MM-DD (org-local dates are handled client-side)
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  locationId: z.string().min(1).optional(),
});

export type GetDailySummaryInput = z.input<typeof getDailySummarySchema>;
