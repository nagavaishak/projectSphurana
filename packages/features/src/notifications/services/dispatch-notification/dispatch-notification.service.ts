import { member, notificationPreference } from '@borradh-workspace/database';
import { withPreferenceDefaults } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { resolveNotificationDelivery } from '../_shared/notification-delivery.js';
import { createNotification } from '../create-notification/index.js';
import {
  type DispatchNotificationInput,
  dispatchNotificationSchema,
} from './dispatch-notification.schema.js';

const dispatchNotificationImpl = async (
  db: DbConnection,
  input: DispatchNotificationInput
): Promise<Result<{ recipientCount: number }>> => {
  const parsed = dispatchNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, type, title, body, linkPath, data, assigneeUserId } =
    parsed.data;

  try {
    // Every member of the org is a candidate; preferences decide who actually
    // receives the notification and through which channels.
    const members = await db.query.member.findMany({
      where: eq(member.organizationId, organizationId),
      with: { user: true },
    });
    if (members.length === 0) return ok({ recipientCount: 0 });

    const prefRows = await db.query.notificationPreference.findMany({
      where: inArray(
        notificationPreference.userId,
        members.map((m) => m.userId)
      ),
    });
    const prefByUser = new Map(prefRows.map((p) => [p.userId, p.preferences]));

    let recipientCount = 0;
    for (const m of members) {
      const decision = resolveNotificationDelivery({
        preferences: withPreferenceDefaults(prefByUser.get(m.userId)),
        type,
        isAssignee: assigneeUserId != null && m.userId === assigneeUserId,
      });
      if (!decision) continue;
      recipientCount += 1;
      // createNotification returns a Result and never throws — one recipient
      // failing must not abort the rest of the fan-out.
      await createNotification(db, {
        organizationId,
        userId: m.userId,
        type,
        title,
        body,
        linkPath,
        data,
        channels: decision,
        recipientEmail: m.user?.email ?? undefined,
        recipientName: m.user?.name ?? undefined,
      });
    }

    return ok({ recipientCount });
  } catch (error) {
    logError('notifications.dispatchNotification', error, {
      feature: 'notifications',
      extra: { organizationId, type },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to dispatch notification'
      )
    );
  }
};

/**
 * High-level: resolves recipients across an organization from each member's
 * notification preferences (scope + channels) and fans the event out into
 * per-user in-app rows plus push / email. Call this fire-and-forget from
 * trigger sites — it returns a Result and never throws.
 */
export const dispatchNotification = (
  db: DbConnection,
  input: DispatchNotificationInput
) =>
  trackedResult(
    'notifications.dispatchNotification',
    () => dispatchNotificationImpl(db, input),
    { properties: { organizationId: input.organizationId, type: input.type } }
  );

export type DispatchNotificationResult = Awaited<
  ReturnType<typeof dispatchNotification>
>;
