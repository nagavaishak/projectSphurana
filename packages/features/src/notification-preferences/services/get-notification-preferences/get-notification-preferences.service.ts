import { randomUUID } from 'node:crypto';
import { notificationPreference } from '@borradh-workspace/database';
import { withPreferenceDefaults } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetNotificationPreferencesInput,
  getNotificationPreferencesSchema,
} from './get-notification-preferences.schema.js';

const getNotificationPreferencesImpl = async (
  db: DbConnection,
  input: GetNotificationPreferencesInput
): Promise<Result<typeof notificationPreference.$inferSelect>> => {
  const parsed = getNotificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const existing = await db.query.notificationPreference.findFirst({
      where: eq(notificationPreference.userId, parsed.data.userId),
    });

    if (existing) {
      // Merge with defaults so a row written before a category existed still
      // reads back complete.
      return ok({
        ...existing,
        preferences: withPreferenceDefaults(existing.preferences),
      });
    }

    // Upsert: create default preferences if none exist
    const [created] = await db
      .insert(notificationPreference)
      .values({
        id: randomUUID(),
        userId: parsed.data.userId,
      })
      .returning();

    return ok({
      ...created,
      preferences: withPreferenceDefaults(created.preferences),
    });
  } catch (error) {
    logError('notificationPreferences.get', error, {
      feature: 'notification-preferences',
      extra: { userId: input.userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to get notification preferences'
      )
    );
  }
};

export const getNotificationPreferences = (
  db: DbConnection,
  input: GetNotificationPreferencesInput
) =>
  trackedResult(
    'notificationPreferences.get',
    () => getNotificationPreferencesImpl(db, input),
    { properties: { userId: input.userId } }
  );

export type GetNotificationPreferencesResult = Awaited<
  ReturnType<typeof getNotificationPreferences>
>;
