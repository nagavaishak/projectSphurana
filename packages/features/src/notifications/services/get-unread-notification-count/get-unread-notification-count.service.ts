import { notification, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, count, eq, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetUnreadNotificationCountInput,
  getUnreadNotificationCountSchema,
} from './get-unread-notification-count.schema.js';

export interface GetUnreadNotificationCountResult {
  count: number;
}

/**
 * Internal implementation of get unread notification count
 */
const getUnreadNotificationCountImpl = async (
  db: DbConnection,
  input: GetUnreadNotificationCountInput
): Promise<Result<GetUnreadNotificationCountResult>> => {
  // Validate input
  const parsed = getUnreadNotificationCountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId } = parsed.data;

  // Count the user's unread notifications (readAt IS NULL)
  const [{ unreadCount }] = await db
    .select({ unreadCount: count() })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));

  return ok({ count: unreadCount });
};

/**
 * Get the number of unread notifications for a user
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User ID
 * @returns Result with the unread count
 *
 * @example
 * ```ts
 * const result = await getUnreadNotificationCount(db, {
 *   userId: 'user_123',
 * });
 * ```
 */
export const getUnreadNotificationCount = (
  db: DbConnection,
  input: GetUnreadNotificationCountInput
) =>
  trackedResult(
    'notifications.getUnreadNotificationCount',
    () =>
      withOrgScope((tx) => getUnreadNotificationCountImpl(tx, input), { db }),
    {
      properties: { userId: input.userId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getUnreadNotificationCount
 */
export type GetUnreadNotificationCountServiceResult = Awaited<
  ReturnType<typeof getUnreadNotificationCount>
>;
