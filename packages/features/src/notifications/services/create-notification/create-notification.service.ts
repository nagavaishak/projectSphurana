import { type Notification, notification } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { sendPushNotification } from '../send-push-notification/index.js';
import {
  type CreateNotificationInput,
  createNotificationSchema,
} from './create-notification.schema.js';

// Resolve a relative linkPath to an absolute URL for the email CTA.
const toActionUrl = async (
  linkPath: string | undefined
): Promise<string | undefined> => {
  if (!linkPath) return undefined;
  const { apiEnv } = await import('@borradh-workspace/env/api');
  return apiEnv.WEB_URL ? `${apiEnv.WEB_URL}${linkPath}` : undefined;
};

const deliverEmail = async (params: {
  to: string;
  recipientName?: string;
  title: string;
  body: string;
  linkPath?: string;
}): Promise<void> => {
  // Imported lazily: the email package validates SMTP env at module load,
  // which must not happen just because this service is imported.
  const { NotificationEmail, sendEmail } = await import(
    '@borradh-workspace/email'
  );
  await sendEmail({
    to: params.to,
    subject: params.title,
    template: NotificationEmail,
    props: {
      recipientName: params.recipientName,
      title: params.title,
      body: params.body,
      actionUrl: await toActionUrl(params.linkPath),
      actionLabel: 'View',
    },
  });
};

const createNotificationImpl = async (
  db: DbConnection,
  input: CreateNotificationInput
): Promise<Result<Notification>> => {
  const parsed = createNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { channels, recipientEmail, recipientName, ...fields } = parsed.data;

  let created: Notification;
  try {
    const [row] = await db
      .insert(notification)
      .values({
        organizationId: fields.organizationId,
        userId: fields.userId,
        type: fields.type,
        title: fields.title,
        body: fields.body,
        linkPath: fields.linkPath ?? null,
        data: fields.data ?? null,
      })
      .returning();
    created = row;
  } catch (error) {
    logError('notifications.createNotification', error, {
      feature: 'notifications',
      extra: { userId: fields.userId, type: fields.type },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create notification'
      )
    );
  }

  // Extra channels are best-effort: a delivery failure must never fail the
  // in-app notification that has already been persisted.
  if (channels?.push) {
    void sendPushNotification(db, {
      userId: fields.userId,
      title: fields.title,
      body: fields.body,
      data: {
        notificationId: created.id,
        type: fields.type,
        ...(fields.data ?? {}),
      },
    }).catch((error) =>
      logError('notifications.createNotification.push', error, {
        feature: 'notifications',
        extra: { userId: fields.userId },
      })
    );
  }

  if (channels?.email && recipientEmail) {
    void deliverEmail({
      to: recipientEmail,
      recipientName,
      title: fields.title,
      body: fields.body,
      linkPath: fields.linkPath,
    }).catch((error) =>
      logError('notifications.createNotification.email', error, {
        feature: 'notifications',
        extra: { userId: fields.userId },
      })
    );
  }

  return ok(created);
};

/**
 * Low-level: persists one in-app notification row for one user and optionally
 * fans it out to push / email. Most callers should use `dispatchNotification`,
 * which resolves recipients + channels from preferences.
 */
export const createNotification = (
  db: DbConnection,
  input: CreateNotificationInput
) =>
  trackedResult(
    'notifications.createNotification',
    () => createNotificationImpl(db, input),
    { properties: { userId: input.userId, type: input.type } }
  );

export type CreateNotificationResult = Awaited<
  ReturnType<typeof createNotification>
>;
