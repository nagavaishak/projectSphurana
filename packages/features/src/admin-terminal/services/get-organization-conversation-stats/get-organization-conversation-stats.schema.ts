import { z } from 'zod';

export const getOrganizationConversationStatsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetOrganizationConversationStatsInput = z.infer<
  typeof getOrganizationConversationStatsSchema
>;
