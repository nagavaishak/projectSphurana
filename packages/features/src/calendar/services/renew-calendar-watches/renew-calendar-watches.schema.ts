import { z } from 'zod';

export const renewCalendarWatchesSchema = z.object({
  /** Renew watches expiring within this many hours */
  expiringWithinHours: z.number().min(1).default(24),
});

export type RenewCalendarWatchesInput = z.infer<
  typeof renewCalendarWatchesSchema
>;
