import { randomUUID } from 'node:crypto';
import { notificationPreference } from '@borradh-workspace/database';
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
  type UpdateNotificationPreferencesInput,
  updateNotificationPreferencesSchema,
} from './update-notification-preferences.schema.js';

const updateNotificationPreferencesImpl = async (
  db: DbConnection,
  input: UpdateNotificationPreferencesInput
): Promise<Result<typeof notificationPreference.$inferSelect>> => {
  const parsed = updateNotificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, ...updates } = parsed.data;

  // Remove undefined values
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );

  try {
    // Upsert: update if exists, create with defaults + overrides if not
    const existing = await db.query.notificationPreference.findFirst({
      where: eq(notificationPreference.userId, userId),
    });

    if (existing) {
      const [updated] = await db
        .update(notificationPreference)
        .set(cleanUpdates)
        .where(eq(notificationPreference.userId, userId))
        .returning();

      return ok(updated);
    }

    // Create with defaults + overrides
    const [created] = await db
      .insert(notificationPreference)
      .values({
        id: randomUUID(),
        userId,
        ...cleanUpdates,
      })
      .returning();

    return ok(created);
  } catch (error) {
    logError('notificationPreferences.update', error, {
      feature: 'notification-preferences',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update notification preferences'
      )
    );
  }
};

export const updateNotificationPreferences = (
  db: DbConnection,
  input: UpdateNotificationPreferencesInput
) =>
  trackedResult(
    'notificationPreferences.update',
    () => updateNotificationPreferencesImpl(db, input),
    { properties: { userId: input.userId } }
  );

export type UpdateNotificationPreferencesResult = Awaited<
  ReturnType<typeof updateNotificationPreferences>
>;
