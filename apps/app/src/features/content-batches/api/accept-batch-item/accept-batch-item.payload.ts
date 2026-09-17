import { acceptBatchItemRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * The typed INTENT for accepting a content-batch item. Accepting also schedules
 * the item to socials, so the (optionally edited) caption / schedule / target
 * pages ride along. When a field is omitted the server falls back to the
 * planner-seeded value on the item.
 *
 * Every surface (batch-review-dialog, socials-mobile-batch-review,
 * content-approval-slide) passes this; only {@link buildAcceptBatchItemPayload}
 * turns it into the wire body. `itemId` is the route param, not part of the
 * body.
 */
export interface AcceptBatchItemInput {
  itemId: string;
  caption?: string;
  /** ISO timestamp; omit/null to schedule as a draft. */
  scheduledAt?: string | null;
  targetPageIds?: string[];
}

/**
 * The wire body for `POST /content-batches/items/:id/accept`, built in exactly
 * one place. `.strict()` so an extra or missing field is a parse error, not a
 * silent strip — this is what stops the three accept surfaces from encoding a
 * different-but-valid body. Only fields the surface actually set are emitted,
 * so an omitted field falls back to the planner-seeded value server-side
 * (rather than being sent as `undefined`).
 */
export const acceptBatchItemBodySchema = acceptBatchItemRequestSchema;

export type AcceptBatchItemBody = z.infer<typeof acceptBatchItemBodySchema>;

export function buildAcceptBatchItemPayload(
  input: AcceptBatchItemInput
): AcceptBatchItemBody {
  // Built as a loose record: the contract COERCES `scheduledAt` from the ISO
  // string on the wire to the `Date` the server schema uses, so the pre-parse
  // shape is not the parsed shape.
  const body: Record<string, unknown> = {};
  if (input.caption !== undefined) body.caption = input.caption;
  if (input.scheduledAt !== undefined) body.scheduledAt = input.scheduledAt;
  if (input.targetPageIds !== undefined) {
    body.targetPageIds = input.targetPageIds;
  }
  return acceptBatchItemBodySchema.parse(body);
}
