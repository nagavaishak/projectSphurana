import { z } from 'zod';

/**
 * Schema for listing a service's variants. Org-scoped on the parent service.
 * `activeOnly` defaults to false so the dashboard editor can load inactive
 * variants too; read configs (venue/booking) pass `activeOnly: true`.
 */
export const listServiceVariantsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  activeOnly: z.boolean().optional(),
});

export type ListServiceVariantsInput = z.infer<
  typeof listServiceVariantsSchema
>;
