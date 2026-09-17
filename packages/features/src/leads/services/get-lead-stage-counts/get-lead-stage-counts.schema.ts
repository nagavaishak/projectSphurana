import { z } from 'zod';

/**
 * Schema for the Customers-surface stage/tab counts.
 */
export const getLeadStageCountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Branch filter, from the validated `X-Location-Id` header — the SAME source
   * `listLeads` takes it from, and omitted for exactly the same reason (no
   * active branch means org-wide).
   *
   * Without it the badges counted the whole org while the table under them
   * counted one branch: "All 36" over 24 rows on the seeded demo, unexplained.
   */
  locationId: z.string().min(1).optional(),
});

export type GetLeadStageCountsInput = z.infer<typeof getLeadStageCountsSchema>;
