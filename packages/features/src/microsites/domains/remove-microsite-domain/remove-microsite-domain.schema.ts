import { z } from 'zod';

export const removeMicrositeDomainSchema = z.object({
  domainId: z.string().min(1),
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced in the SERVICE, not the controller. */
  organizationId: z.string().min(1),
});

export type RemoveMicrositeDomainInput = z.infer<
  typeof removeMicrositeDomainSchema
>;
