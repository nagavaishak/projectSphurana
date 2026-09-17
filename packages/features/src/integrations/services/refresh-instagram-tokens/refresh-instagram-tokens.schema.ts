import { z } from 'zod';

export const refreshInstagramTokensSchema = z.object({
  /** Refresh tokens expiring within this many days (default: 7) */
  daysBeforeExpiry: z.number().int().positive().default(7),
});

export type RefreshInstagramTokensInput = z.infer<
  typeof refreshInstagramTokensSchema
>;
