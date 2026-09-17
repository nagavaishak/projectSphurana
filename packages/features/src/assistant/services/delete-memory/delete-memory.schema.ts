import { z } from 'zod';

/**
 * Input shape for `deleteMemory`.
 *
 * Authorization (per claire.md §2 Q5 — defer to backend RBAC; v3 uses the
 * simplest defensible rule):
 *   - Personal entry (`user_id = $userId`) → owner can delete.
 *   - Org-wide entry (`user_id IS NULL`) → only org admins / owners can
 *     delete (resolved via `checkAdminAccess`).
 *
 * Hard-delete semantics — no soft-delete column on `knowledge_entry`.
 */
export const deleteMemorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export type DeleteMemoryInput = z.infer<typeof deleteMemorySchema>;

export interface DeleteMemoryOutput {
  deleted: true;
  knowledgeEntryId: string;
}
