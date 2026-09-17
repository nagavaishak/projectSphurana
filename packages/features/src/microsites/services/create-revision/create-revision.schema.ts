import { z } from 'zod';

/**
 * `agent` for an agent turn, `user` for a hand edit, `system` for provisioning
 * and migrations. `promptId` is only meaningful for `agent`.
 */
export const micrositeRevisionAuthorSchema = z.enum([
  'agent',
  'user',
  'system',
]);

export const createRevisionSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced here, not in the controller (plan §12). */
  organizationId: z.string().min(1),
  createdBy: micrositeRevisionAuthorSchema,
  label: z.string().trim().min(1).max(200).optional(),
  promptId: z.string().min(1).optional(),
});

export type CreateRevisionInput = z.infer<typeof createRevisionSchema>;
