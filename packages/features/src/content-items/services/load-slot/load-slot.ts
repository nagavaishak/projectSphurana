import {
  type ContentAttempt,
  type ContentItem,
  contentAttempt,
  contentItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/**
 * A post as every editing service needs it: the slot, plus the cut currently in
 * it.
 *
 * `slot` owns the decision, the schedule and the conversation. `attempt` owns
 * the asset, the caption and any staged edits. Which one a write belongs to is
 * the question this split exists to make answerable — and having both in hand
 * means no service has to re-derive "which row is current".
 */
export interface SlotWithAttempt {
  slot: ContentItem;
  attempt: ContentAttempt;
}

/**
 * Load one post for an organisation, or fail.
 *
 * Six services opened this exact query by hand — a join through `content_batch`
 * to prove ownership, plus whatever each one needed from the item. Six copies
 * of an ownership check is six chances to write the seventh without one, so it
 * lives here now.
 *
 * The ownership join is gone: `content_item` carries `organization_id` itself,
 * so this is a predicate rather than a hop through the grouping. That is what
 * lets a standalone item — one with no batch to be joined to — be loaded by the
 * same function, which is the entire point of the split.
 *
 * A foreign org's `itemId` returns NOT_FOUND rather than FORBIDDEN: replying
 * "not yours" confirms the id exists, which is a slower way of leaking the same
 * thing. Callers map both to 404 anyway.
 */
export const loadSlotForOrg = async (
  db: DbConnection,
  input: { itemId: string; organizationId: string }
): Promise<Result<SlotWithAttempt>> => {
  const rows = await withOrgScope(
    (tx) =>
      tx
        .select({
          slot: contentItem,
          attempt: contentAttempt,
        })
        .from(contentItem)
        // INNER, not LEFT: a slot without a live attempt is not a state the app
        // can reach — the slot and its attempt 0 are inserted in one
        // transaction — so treating it as "no such post" is honest, and it
        // keeps every caller off a null check for something that cannot happen.
        .innerJoin(
          contentAttempt,
          eq(contentAttempt.id, contentItem.currentAttemptId)
        )
        .where(
          and(
            eq(contentItem.id, input.itemId),
            eq(contentItem.organizationId, input.organizationId)
          )
        )
        .limit(1),
    { db }
  );

  const row = rows[0];
  if (!row) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Item not found', {
        itemId: input.itemId,
      })
    );
  }

  return ok({ slot: row.slot, attempt: row.attempt });
};

/**
 * As `loadSlotForOrg`, but refuses a post the owner has already decided.
 *
 * Every editing path needs this and each stated it slightly differently. It is
 * a real guard, not ceremony: accepting a post schedules a `social_post` from
 * its caption, so a rewrite that lands afterwards changes copy that has already
 * gone out the door.
 */
export const loadPendingSlotForOrg = async (
  db: DbConnection,
  input: { itemId: string; organizationId: string }
): Promise<Result<SlotWithAttempt>> => {
  const loaded = await loadSlotForOrg(db, input);
  if (!loaded.success) return loaded;

  if (loaded.data.slot.reviewStatus !== 'pending') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'This post has already been decided and can no longer be edited',
        { currentStatus: loaded.data.slot.reviewStatus }
      )
    );
  }

  return ok(loaded.data);
};
