import { randomUUID } from 'node:crypto';
import { devicePushToken } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type RegisterPushTokenInput,
  registerPushTokenSchema,
} from './register-push-token.schema.js';

const registerPushTokenImpl = async (
  db: DbConnection,
  input: RegisterPushTokenInput
): Promise<Result<typeof devicePushToken.$inferSelect>> => {
  const parsed = registerPushTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // ONE atomic upsert on the token's unique constraint.
    //
    // This used to read-then-insert, which races: two devices (or two tabs)
    // registering the same token concurrently both saw "not found" and both
    // inserted. The catch below recovered — it returned the existing row — but
    // Postgres had already raised, so every race surfaced in Sentry as
    // `duplicate key value violates unique constraint
    // "device_push_token_token_unique"` (BOR-70: ~1.5k events over 5 months).
    //
    // `onConflictDoUpdate` makes the conflict the NORMAL path: the row is
    // rewritten with the current user/platform (a device can switch users, or
    // move from the Expo build to Capacitor) and nothing throws.
    const [result] = await db
      .insert(devicePushToken)
      .values({
        id: randomUUID(),
        ...parsed.data,
      })
      .onConflictDoUpdate({
        target: devicePushToken.token,
        set: {
          userId: parsed.data.userId,
          platform: parsed.data.platform,
          tokenType: parsed.data.tokenType,
        },
      })
      .returning();

    return ok(result);
  } catch (error) {
    // No check-then-insert branch here: the insert above is a single atomic
    // `onConflictDoUpdate` on the token's unique constraint, so a unique
    // violation on `devicePushToken.token` cannot happen — Postgres resolves
    // the conflict inside the statement instead of raising 23505. (The old
    // "re-fetch on duplicate" recovery branch that used to live here was dead
    // code matching `error.message` for a violation this statement can never
    // throw; ENG-844.)
    logError('notifications.registerPushToken', error, {
      feature: 'notifications',
      extra: { userId: input.userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to register push token'
      )
    );
  }
};

export const registerPushToken = (
  db: DbConnection,
  input: RegisterPushTokenInput
) =>
  trackedResult(
    'notifications.registerPushToken',
    () => registerPushTokenImpl(db, input),
    { properties: { userId: input.userId, platform: input.platform } }
  );

export type RegisterPushTokenResult = Awaited<
  ReturnType<typeof registerPushToken>
>;
