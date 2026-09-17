import {
  type Notification,
  notification,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type MarkNotificationReadInput,
  markNotificationReadSchema,
} from './mark-notification-read.schema.js';

/**
 * Internal implementation of mark notification read
 */
const markNotificationReadImpl = async (
  db: DbConnection,
  input: MarkNotificationReadInput
): Promise<Result<Notification>> => {
  // Validate input
  const parsed = markNotificationReadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, userId } = parsed.data;

  // Set readAt, scoped to the owning user (ownership check). Idempotent:
  // re-marking an already-read row simply overwrites readAt.
  const [row] = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.id, id), eq(notification.userId, userId)))
    .returning();

  if (!row) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Notification with ID ${id} not found`,
        { id }
      )
    );
  }

  return ok(row);
};

/**
 * Mark a single notification as read
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Notification ID and owning user ID
 * @returns Result with the updated notification or NOT_FOUND error
 *
 * @example
 * ```ts
 * const result = await markNotificationRead(db, {
 *   id: 'notif_123',
 *   userId: 'user_123',
 * });
 * ```
 */
export const markNotificationRead = (
  db: DbConnection,
  input: MarkNotificationReadInput
) =>
  trackedResult(
    'notifications.markNotificationRead',
    () => withOrgScope((tx) => markNotificationReadImpl(tx, input), { db }),
    {
      properties: { notificationId: input.id, userId: input.userId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for markNotificationRead
 */
export type MarkNotificationReadResult = Awaited<
  ReturnType<typeof markNotificationRead>
>;
