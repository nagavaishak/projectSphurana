import { z } from 'zod';

export const getPageInsightsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  since: z.string().optional(),
  until: z.string().optional(),
});

export type GetPageInsightsInput = z.infer<typeof getPageInsightsSchema>;
