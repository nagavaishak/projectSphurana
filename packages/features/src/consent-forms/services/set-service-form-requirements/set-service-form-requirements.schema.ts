import { z } from 'zod';

export const setServiceFormRequirementsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  /** The EXACT set of required templates — the join table is reconciled to it. */
  templateIds: z.array(z.string().min(1)).max(50),
});

export type SetServiceFormRequirementsInput = z.infer<
  typeof setServiceFormRequirementsSchema
>;
