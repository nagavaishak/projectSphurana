import { z } from 'zod';

export const listServiceFormRequirementsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
});

export type ListServiceFormRequirementsInput = z.infer<
  typeof listServiceFormRequirementsSchema
>;
