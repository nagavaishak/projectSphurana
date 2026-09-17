import { z } from 'zod';

export const setPrimaryDomainSchema = z.object({
  domainId: z.string().min(1),
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced in the SERVICE, not the controller. */
  organizationId: z.string().min(1),
});

export type SetPrimaryDomainInput = z.infer<typeof setPrimaryDomainSchema>;
