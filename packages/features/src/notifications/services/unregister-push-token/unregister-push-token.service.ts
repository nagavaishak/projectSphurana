import { devicePushToken } from '@borradh-workspace/database';
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
  type UnregisterPushTokenInput,
  unregisterPushTokenSchema,
} from './unregister-push-token.schema.js';

const unregisterPushTokenImpl = async (
  db: DbConnection,
  input: UnregisterPushTokenInput
): Promise<Result<{ success: boolean }>> => {
  const parsed = unregisterPushTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    await db
      .delete(devicePushToken)
      .where(eq(devicePushToken.token, parsed.data.token));

    return ok({ success: true });
  } catch (error) {
    logError('notifications.unregisterPushToken', error, {
      feature: 'notifications',
      extra: { token: input.token },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to unregister push token'
      )
    );
  }
};

export const unregisterPushToken = (
  db: DbConnection,
  input: UnregisterPushTokenInput
) =>
  trackedResult(
    'notifications.unregisterPushToken',
    () => unregisterPushTokenImpl(db, input),
    { properties: { token: `${input.token.slice(0, 20)}...` } }
  );

export type UnregisterPushTokenResult = Awaited<
  ReturnType<typeof unregisterPushToken>
>;
