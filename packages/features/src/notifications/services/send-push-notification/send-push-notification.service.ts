import { devicePushToken } from '@borradh-workspace/database';
import {
  createLogger,
  getDeployEnvironment,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { dispatchApns } from './dispatch-apns.js';
import { dispatchExpo } from './dispatch-expo.js';
import { dispatchFcm } from './dispatch-fcm.js';
import type { DispatchResult } from './types.js';

const logger = createLogger('notifications.push');

export interface SendPushNotificationInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const sendPushNotificationImpl = async (
  db: DbConnection,
  input: SendPushNotificationInput
): Promise<Result<{ sent: number; failed: number }>> => {
  const { userId, title, body, data } = input;

  if (!userId || !title || !body) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'userId, title, and body are required'
      )
    );
  }

  const tokens = await db.query.devicePushToken.findMany({
    where: eq(devicePushToken.userId, userId),
  });

  if (tokens.length === 0) {
    return ok({ sent: 0, failed: 0 });
  }

  const byType = {
    expo: [] as string[],
    fcm: [] as string[],
    apns: [] as string[],
  };
  for (const t of tokens) {
    byType[t.tokenType].push(t.token);
  }

  const dispatched: DispatchResult[] = await Promise.all([
    dispatchExpo({ tokens: byType.expo, title, body, data, userId }),
    dispatchFcm({ tokens: byType.fcm, title, body, data, userId }),
    dispatchApns({ tokens: byType.apns, title, body, data, userId }),
  ]);
  // Positional, matching the Promise.all order above, so a delivery log can
  // name which provider actually landed the notification.
  const providers = ['expo', 'fcm', 'apns'] as const;

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];
  const configErrors: string[] = [];
  const sentByProvider: Record<string, number> = {};
  for (const [i, r] of dispatched.entries()) {
    sent += r.sent;
    failed += r.failed;
    invalidTokens.push(...r.invalidTokens);
    if (r.configError) configErrors.push(r.configError);
    if (r.sent > 0) sentByProvider[providers[i]] = r.sent;
  }

  // True when nothing was even attempted: every provider that reported a
  // failure did so because it has no credentials in this environment, rather
  // than because a send was tried and rejected.
  const onlyUnconfiguredFailures =
    configErrors.length > 0 &&
    dispatched.every((r) => r.failed === 0 || Boolean(r.configError));

  if (invalidTokens.length > 0) {
    try {
      await db
        .delete(devicePushToken)
        .where(inArray(devicePushToken.token, invalidTokens));
    } catch {
      // Non-critical cleanup, errors already logged in dispatchers if relevant
    }
  }

  // Dead tokens are NOT an outage: an uninstalled app is the expected end of a
  // token's life, and we just deleted them above. A user whose only device is
  // gone would otherwise produce sent=0/failed=1 on every notification and page
  // someone forever. Only failures beyond the dead ones indicate a real fault.
  const realFailures = failed - invalidTokens.length;

  // The user had tokens and not one notification landed. Returning ok() here is
  // how a total outage (e.g. credentials never set in an environment) stayed
  // invisible for weeks: every caller is best-effort and none of them look at
  // the numbers, so nothing alerted. Fail loudly instead — callers are
  // unaffected, since they neither throw on nor inspect a failed Result.
  //
  // logError() is what actually puts a line in Better Stack: trackedResult only
  // adds a Sentry breadcrumb and a PostHog event for a failed Result, it does
  // NOT log (see packages/observability/src/tracked.ts). Without this call the
  // "loud" failure would still be invisible in the logs, which is the exact
  // failure mode this change exists to remove. The `operation` field it emits
  // is what the "Push Delivery Failures" metric expression keys off.
  if (sent === 0 && realFailures > 0) {
    const reason =
      configErrors.length > 0
        ? configErrors.join('; ')
        : 'all providers rejected the send';
    const failure = new FeatureError(
      ErrorCodes.INTERNAL_ERROR,
      `Push delivery failed for all ${failed} token(s): ${reason}`,
      { sent, failed, configErrors }
    );

    // An environment that deliberately ships without push credentials is a
    // deployment fact, not an outage. Preview is exactly that: .github/preview.env
    // sets FCM_DRY_RUN=true and provides no FCM_SERVICE_ACCOUNT_BASE64 or
    // APNS_KEY_P8_BASE64 at all, so EVERY push there ends up here. All 57 events
    // of Sentry issue API-FC came from preview and none from production.
    //
    // Production keeps the loud path unconditionally — that is the whole point
    // of this branch and of PR #798, where credentials silently absent in prod
    // went unnoticed for weeks. Note this only downgrades the *unconfigured*
    // case: a preview that has credentials and still fails every send is a real
    // fault and is reported as one.
    if (onlyUnconfiguredFailures && getDeployEnvironment() !== 'production') {
      logger.warn(`Push delivery skipped — ${reason}`, {
        userId,
        sent,
        failed,
        realFailures,
        configErrors,
        environment: getDeployEnvironment(),
      });
      return err(failure);
    }

    logError('notifications.sendPushNotification', failure, {
      feature: 'notifications',
      extra: { userId, sent, failed, realFailures, configErrors },
    });
    return err(failure);
  }

  // Partial failure still delivered something, so it is not an error — but it
  // must not be silent either.
  if (failed > 0) {
    logger.warn('Push delivery partially failed', {
      userId,
      sent,
      failed,
      sentByProvider,
      ...(configErrors.length > 0 ? { configErrors } : {}),
    });
  } else if (sent > 0) {
    // A delivery that worked is as worth recording as one that failed. Without
    // this line the only push signal in Better Stack is the failure path, so a
    // silent graph is indistinguishable from "nothing has tried to push" — the
    // precise ambiguity that made a real production outage hard to confirm
    // either way. `operation` matches the field logError emits on the failure
    // path so success and failure can be counted against each other in one
    // query, and so a delivery-rate metric can key off the same name.
    logger.info('Push delivered', {
      operation: 'notifications.sendPushNotification',
      feature: 'notifications',
      userId,
      sent,
      sentByProvider,
    });
  }

  return ok({ sent, failed });
};

export const sendPushNotification = (
  db: DbConnection,
  input: SendPushNotificationInput
) =>
  trackedResult(
    'notifications.sendPushNotification',
    () => sendPushNotificationImpl(db, input),
    {
      properties: { userId: input.userId },
    }
  );

export type SendPushNotificationResult = Awaited<
  ReturnType<typeof sendPushNotification>
>;
