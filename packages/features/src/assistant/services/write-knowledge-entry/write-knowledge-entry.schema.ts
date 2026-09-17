import { knowledgeEntryTypeValues } from '@borradh-workspace/database';
import { z } from 'zod';

/**
 * Input shape for `writeKnowledgeEntry`.
 *
 * `userId` is nullable: `null` writes an org-wide entry (`user_id IS NULL`);
 * a non-null value scopes the entry to that user. The `remember` factory
 * tool maps its `scope: 'personal' | 'organization'` discriminator onto
 * this field.
 *
 * The schema does not validate the `type` against the enum at the Zod
 * level — the column itself is a Postgres enum and Drizzle/postgres-js will
 * reject an unknown value at insert time. We do narrow it via TypeScript
 * with `z.enum(knowledgeEntryTypeValues)` so callers get an editor-time
 * error if they pass an unsupported value.
 */
export const writeKnowledgeEntrySchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1).nullable(),
  type: z.enum(knowledgeEntryTypeValues),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  source: z.enum(['auto', 'ai', 'manual']).default('manual'),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WriteKnowledgeEntryInput = z.infer<
  typeof writeKnowledgeEntrySchema
>;

/**
 * Output of `writeKnowledgeEntry`. Returns the inserted row's ID so the
 * caller (the `remember` tool) can echo it back to the model in the tool
 * result envelope without re-querying.
 */
export interface WriteKnowledgeEntryOutput {
  knowledgeEntryId: string;
}
