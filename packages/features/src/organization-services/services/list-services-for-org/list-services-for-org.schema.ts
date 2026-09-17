import { z } from 'zod';

export const listServicesForOrgSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListServicesForOrgInput = z.infer<typeof listServicesForOrgSchema>;
