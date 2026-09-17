import { z } from 'zod';

export const getServiceResourceRequirementsSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
});

export type GetServiceResourceRequirementsInput = z.infer<
  typeof getServiceResourceRequirementsSchema
>;
