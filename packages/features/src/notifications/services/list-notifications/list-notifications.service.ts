import {
  type Notification,
  notification,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { count, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListNotificationsInput,
  listNotificationsSchema,
} from './list-notifications.schema.js';

export interface ListNotificationsResult {
  items: Notification[];
  total: number;
}

/**
 * Internal implementation of list notifications
 */
const listNotificationsImpl = async (
  db: DbConnection,
  input: ListNotificationsInput
): Promise<Result<ListNotificationsResult>> => {
  // Validate input
  const parsed = listNotificationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, limit, offset } = parsed.data;

  // Fetch the user's notifications, newest first
  const items = await db.query.notification.findMany({
    where: eq(notification.userId, userId),
    orderBy: [desc(notification.createdAt)],
    limit,
    offset,
  });

  // Count all of the user's notifications for pagination
  const [{ total }] = await db
    .select({ total: count() })
    .from(notification)
    .where(eq(notification.userId, userId));

  return ok({ items, total });
};

/**
 * List a user's notifications, newest first
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User ID with pagination
 * @returns Result with notification items and total count
 *
 * @example
 * ```ts
 * const result = await listNotifications(db, {
 *   userId: 'user_123',
 *   limit: 20,
 * });
 * ```
 */
export const listNotifications = (
  db: DbConnection,
  input: ListNotificationsInput
) =>
  trackedResult(
    'notifications.listNotifications',
    () => withOrgScope((tx) => listNotificationsImpl(tx, input), { db }),
    {
      properties: { userId: input.userId },
    }
  );

/**
 * Result type for listNotifications
 */
export type ListNotificationsServiceResult = Awaited<
  ReturnType<typeof listNotifications>
>;
