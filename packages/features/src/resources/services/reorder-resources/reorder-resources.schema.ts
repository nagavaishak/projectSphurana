import { z } from 'zod';
import { sortOrderSchema } from '../_shared/index.js';

export const reorderResourcesSchema = z.object({
  organizationId: z.string().min(1),
  /**
   * The branch the reordering page was showing, from the validated
   * `X-Location-Id` header.
   *
   * DEFENCE IN DEPTH, not a live bug: the service only writes ids it was
   * handed, and every one is already checked to belong to the org, so a
   * branch-scoped page cannot renumber another branch by accident. What is
   * missing without this is the deliberate case — a client that PASSES another
   * branch's ids is currently obeyed.
   *
   * Undefined means org-wide, matching every other branch-aware read. A
   * location-less resource (a trolley) is reorderable from any branch, since
   * it appears in all of them and its order is the order the user just saw.
   */
  locationId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: sortOrderSchema,
      })
    )
    .min(1)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      { message: 'Each resource may appear only once' }
    ),
});

export type ReorderResourcesInput = z.infer<typeof reorderResourcesSchema>;
