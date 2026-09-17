import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const computeCampaignCacSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Inclusive, in UTC days. Defaults to the trailing 30 days. */
  dateRange: z
    .object({ since: isoDate, until: isoDate })
    .refine((r) => r.since <= r.until, {
      message: '`since` must not be after `until`',
    })
    .optional(),
  /** Restrict to leads from one site. Omit for the whole org. */
  micrositeId: z.string().min(1).optional(),
});

export type ComputeCampaignCacInput = z.infer<typeof computeCampaignCacSchema>;
