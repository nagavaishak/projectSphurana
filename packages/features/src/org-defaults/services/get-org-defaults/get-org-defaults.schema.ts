import { z } from 'zod';

export const getOrgDefaultsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetOrgDefaultsInput = z.infer<typeof getOrgDefaultsSchema>;
