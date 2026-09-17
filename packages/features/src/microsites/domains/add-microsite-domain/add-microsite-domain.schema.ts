import { z } from 'zod';

export const addMicrositeDomainSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced in the SERVICE, not the controller. */
  organizationId: z.string().min(1),
  /**
   * Raw tenant input. Deliberately loose here — a scheme, a path, mixed case
   * and a trailing dot all arrive in practice. `validateMicrositeDomain` is the
   * real gate; duplicating its rules in Zod would give us two places to keep
   * the "never our own apex" rule, and one of them would rot.
   */
  domain: z.string().trim().min(1).max(512),
});

export type AddMicrositeDomainInput = z.infer<typeof addMicrositeDomainSchema>;
