import { notification, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type MarkAllNotificationsReadInput,
  markAllNotificationsReadSchema,
} from './mark-all-notifications-read.schema.js';

export interface MarkAllNotificationsReadResult {
  updated: number;
}

/**
 * Internal implementation of mark all notifications read
 */
const markAllNotificationsReadImpl = async (
  db: DbConnection,
  input: MarkAllNotificationsReadInput
): Promise<Result<MarkAllNotificationsReadResult>> => {
  // Validate input
  const parsed = markAllNotificationsReadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId } = parsed.data;

  // Set readAt on every currently-unread notification for this user.
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .returning({ id: notification.id });

  return ok({ updated: rows.length });
};

/**
 * Mark all of a user's unread notifications as read
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User ID
 * @returns Result with the number of notifications updated
 *
 * @example
 * ```ts
 * const result = await markAllNotificationsRead(db, {
 *   userId: 'user_123',
 * });
 * ```
 */
export const markAllNotificationsRead = (
  db: DbConnection,
  input: MarkAllNotificationsReadInput
) =>
  trackedResult(
    'notifications.markAllNotificationsRead',
    () => withOrgScope((tx) => markAllNotificationsReadImpl(tx, input), { db }),
    {
      properties: { userId: input.userId },
    }
  );

/**
 * Result type for markAllNotificationsRead
 */
export type MarkAllNotificationsReadServiceResult = Awaited<
  ReturnType<typeof markAllNotificationsRead>
>;
