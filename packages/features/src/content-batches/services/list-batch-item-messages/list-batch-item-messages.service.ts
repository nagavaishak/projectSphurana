import { contentItemMessage, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { ReviewThreadMessage } from '../handle-review-turn/handle-review-turn.schema.js';
import {
  type ListBatchItemMessagesInput,
  listBatchItemMessagesSchema,
} from './list-batch-item-messages.schema.js';

/**
 * The review thread for one item, oldest first.
 *
 * Empty is the normal case, not an error — most posts are accepted without a
 * word. The UI shows Claire's opening line for an empty thread and the real
 * history for one that has been edited, which is what makes moving back through
 * the queue feel like returning to work rather than starting over.
 */
const listBatchItemMessagesImpl = async (
  db: DbConnection,
  input: ListBatchItemMessagesInput
): Promise<Result<{ messages: ReviewThreadMessage[] }>> => {
  const parsed = listBatchItemMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId } = parsed.data;

  try {
    // Join out to the batch so a foreign org's itemId returns nothing rather
    // than someone else's thread.
    const rows = await withOrgScope(
      (tx) =>
        tx
          .select({
            id: contentItemMessage.id,
            role: contentItemMessage.role,
            content: contentItemMessage.content,
            captionSnapshot: contentItemMessage.captionSnapshot,
            createdAt: contentItemMessage.createdAt,
          })
          .from(contentItemMessage)
          // Scoped on the message's own `organization_id` rather than joined
          // through `content_batch`. That join was an INNER one, so with
          // `batch_id` now nullable it would silently return ZERO messages for
          // a standalone item — the thread would simply not be there, with no
          // error to explain it.
          .where(
            and(
              eq(contentItemMessage.itemId, itemId),
              eq(contentItemMessage.organizationId, organizationId)
            )
          )
          .orderBy(asc(contentItemMessage.createdAt)),
      { db }
    );

    return ok({
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        captionSnapshot: row.captionSnapshot,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logError('contentBatches.listBatchItemMessages', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load the review thread'
      )
    );
  }
};

export const listBatchItemMessages = (
  db: DbConnection,
  input: ListBatchItemMessagesInput
) =>
  trackedResult(
    'contentBatches.listBatchItemMessages',
    () => listBatchItemMessagesImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListBatchItemMessagesResult = Awaited<
  ReturnType<typeof listBatchItemMessages>
>;
