import { z } from 'zod';

export const getLeadStatsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetLeadStatsInput = z.infer<typeof getLeadStatsSchema>;
