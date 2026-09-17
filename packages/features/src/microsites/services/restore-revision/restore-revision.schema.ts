import { z } from 'zod';

export const restoreRevisionSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced here, not in the controller (plan §12). */
  organizationId: z.string().min(1),
  /** The snapshot to make the draft. Any revision of this site — undo OR redo. */
  revisionId: z.string().min(1),
});

export type RestoreRevisionInput = z.infer<typeof restoreRevisionSchema>;
