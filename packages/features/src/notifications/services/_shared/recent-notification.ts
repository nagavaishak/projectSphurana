import { notification } from '@borradh-workspace/database';
import type { NotificationType } from '@borradh-workspace/labels';
import { logError } from '@borradh-workspace/observability';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * How long after a lead arrives a follow-on event counts as "the same arrival".
 * A lead that messages and is escalated does both within seconds; five minutes
 * is comfortably wider than that without swallowing a genuine later handoff.
 */
export const SAME_ARRIVAL_WINDOW_MS = 5 * 60 * 1000;

interface HasRecentNotificationInput {
  organizationId: string;
  type: NotificationType;
  /** Matched against the notification's `data` JSON. */
  dataKey: string;
  dataValue: string;
  withinMs?: number;
}

/**
 * True when a notification of this type carrying this `data` key/value was
 * created inside the window. Used to collapse two notifications that describe
 * one real-world arrival into a single ping.
 *
 * Never throws — on failure it returns false, so a dedup problem degrades to
 * the pre-existing behaviour (send it) rather than silently dropping alerts.
 */
export const hasRecentNotification = async (
  db: DbConnection,
  input: HasRecentNotificationInput
): Promise<boolean> => {
  const {
    organizationId,
    type,
    dataKey,
    dataValue,
    withinMs = SAME_ARRIVAL_WINDOW_MS,
  } = input;
  try {
    const since = new Date(Date.now() - withinMs);
    const existing = await db.query.notification.findFirst({
      where: and(
        eq(notification.organizationId, organizationId),
        eq(notification.type, type),
        gt(notification.createdAt, since),
        sql`${notification.data}->>${dataKey} = ${dataValue}`
      ),
      columns: { id: true },
    });
    return existing != null;
  } catch (error) {
    logError('notifications.hasRecentNotification', error, {
      feature: 'notifications',
      extra: { organizationId, type, dataKey, dataValue },
    });
    return false;
  }
};
