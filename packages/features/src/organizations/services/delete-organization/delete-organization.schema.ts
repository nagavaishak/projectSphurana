import { z } from 'zod';

export const deleteOrganizationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  requesterId: z.string().min(1, 'Requester ID is required'),
});

export type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
