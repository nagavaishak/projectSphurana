import { z } from 'zod';

/**
 * Input shape for `listMemories`.
 *
 * The C-14 settings UI shows the user's memory list — defaults to type
 * `'preference'` because conversation summaries + operational snapshots
 * are internal populator output, not user-managed entries.
 *
 * Org + user scope returns the union: org-wide entries (`user_id IS NULL`)
 * plus the requesting user's personal entries (`user_id = $userId`). Other
 * users' personal entries are never visible.
 */
export const listMemoriesSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(['preference']).optional(),
  // `limit`/`offset` arrive as query-string values on `GET /assistant/memories`
  // (always strings over the wire), so coerce — `z.number()` would reject
  // `?limit=100`. Coercion is a no-op when called programmatically with numbers.
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListMemoriesInput = z.infer<typeof listMemoriesSchema>;

/**
 * One row of the C-14 memories list, in the shape the settings UI consumes.
 *
 * `scope` is derived from ownership — an entry with no `userId` is visible to
 * the whole organization. Timestamps are ISO-8601 strings so the shape is
 * stable end to end (see `.claude/rules/_patterns/type-sharing.md`).
 */
export interface ListMemoriesItem {
  id: string;
  organizationId: string;
  userId: string | null;
  type: string;
  title: string;
  content: string;
  source: string | null;
  confidence: number | null;
  metadata: unknown;
  scope: 'organization' | 'personal';
  createdAt: string;
  updatedAt: string;
}

export interface ListMemoriesOutput {
  items: ListMemoriesItem[];
  total: number;
  limit: number;
  offset: number;
}
