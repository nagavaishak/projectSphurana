import { z } from 'zod';

/**
 * Input shape for `editMemory`.
 *
 * Authorization rules mirror `deleteMemory`:
 *   - Personal entry → owner can edit.
 *   - Org-wide entry → only org admins / owners can edit.
 *
 * `content` length matches `writeKnowledgeEntry`'s 1–2000 character bound
 * — same column, same hard-block surface (we re-run the d2b validator on
 * the new content before saving).
 */
export const editMemorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  content: z.string().min(1).max(2000),
});

export type EditMemoryInput = z.infer<typeof editMemorySchema>;

export interface EditMemoryOutput {
  knowledgeEntryId: string;
  content: string;
  /** ISO-8601 string — stable wire shape for the settings UI. */
  updatedAt: string;
}
