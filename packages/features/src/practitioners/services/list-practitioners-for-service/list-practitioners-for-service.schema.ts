import { z } from 'zod';

export const listPractitionersForServiceSchema = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  activeOnly: z.boolean().default(true),
});

export type ListPractitionersForServiceInput = z.infer<
  typeof listPractitionersForServiceSchema
>;
