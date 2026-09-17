import { z } from 'zod';

export const backfillAnalyticsSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type BackfillAnalyticsInput = z.infer<typeof backfillAnalyticsSchema>;
