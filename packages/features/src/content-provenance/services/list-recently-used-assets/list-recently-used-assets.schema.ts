import { z } from 'zod';

export const listRecentlyUsedAssetsSchema = z.object({
  organizationId: z.string().min(1),
  /** Scope to one service. Omit for org-wide variety. */
  serviceId: z.string().min(1).optional(),
  /**
   * How far back "recently" reaches. A month roughly matches the content
   * cadence — a batch shouldn't repeat itself, but an asset unused for a
   * couple of months is fair game again.
   */
  lookbackDays: z.number().int().min(1).max(365).default(45),
  /** Cap the history scan; the ranking only needs the recent head. */
  limit: z.number().int().min(1).max(500).default(100),
});

export type ListRecentlyUsedAssetsInput = z.infer<
  typeof listRecentlyUsedAssetsSchema
>;
