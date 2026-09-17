import { acceptBatchItemRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `acceptBatchItemRequestBase` in
 * `packages/contracts/src/requests/content.ts`, where the review-time-override
 * semantics (absent vs `null` `scheduledAt`) are documented.
 */
export const acceptBatchItemSchema = acceptBatchItemRequestBase.extend({
  itemId: z.string().min(1, 'Item ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** User the resulting social post is attributed to. */
  createdById: z.string().min(1, 'createdById is required'),
});

export type AcceptBatchItemInput = z.infer<typeof acceptBatchItemSchema>;
