import { z } from 'zod';

export const clearActiveOrgSessionsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ClearActiveOrgSessionsInput = z.infer<
  typeof clearActiveOrgSessionsSchema
>;
