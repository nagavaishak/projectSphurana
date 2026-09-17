import { z } from 'zod';

export const getOrganizationWithMembersSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetOrganizationWithMembersInput = z.infer<
  typeof getOrganizationWithMembersSchema
>;
