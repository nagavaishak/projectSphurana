import { z } from 'zod';

export const refreshMetaTokensSchema = z.object({
  /** Refresh tokens expiring within this many days (default: 7) */
  daysBeforeExpiry: z.number().int().positive().default(7),
});

export type RefreshMetaTokensInput = z.infer<typeof refreshMetaTokensSchema>;
