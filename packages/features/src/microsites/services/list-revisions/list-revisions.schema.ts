import { z } from 'zod';

export const listRevisionsSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced here, not in the controller (plan §12). */
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  /**
   * Opaque — `${createdAt ISO}|${id}`. A plain timestamp is not enough: two
   * revisions written in the same millisecond (an agent turn and the publish
   * that follows it) would make one of them fall off the page.
   */
  cursor: z.string().min(1).optional(),
});

export type ListRevisionsInput = z.input<typeof listRevisionsSchema>;
