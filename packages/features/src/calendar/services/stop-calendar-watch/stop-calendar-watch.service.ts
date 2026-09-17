import { calendarAccount, withOrgScope } from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
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
  type StopCalendarWatchInput,
  stopCalendarWatchSchema,
} from './stop-calendar-watch.schema.js';

const stopCalendarWatchImpl = async (
  db: DbConnection,
  input: StopCalendarWatchInput
): Promise<Result<{ stopped: boolean }>> => {
  const parsed = stopCalendarWatchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { calendarAccountId, organizationId } = parsed.data;

  const calAccount = await db.query.calendarAccount.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(
        eqOp(t.id, calendarAccountId),
        eqOp(t.organizationId, organizationId)
      ),
  });

  if (!calAccount) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Calendar account not found')
    );
  }

  // Nothing to stop if no watch is active
  if (!calAccount.watchChannelId || !calAccount.watchResourceId) {
    return ok({ stopped: false });
  }

  try {
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    }>(calAccount.encryptedCredentials);

    let accessToken = credentials.accessToken;

    if (
      calAccount.tokenExpiresAt &&
      new Date() >= calAccount.tokenExpiresAt &&
      credentials.refreshToken
    ) {
      const oauthService = new GoogleCalendarOAuthService();
      const newTokens = await oauthService.refreshAccessToken(
        credentials.refreshToken
      );
      accessToken = newTokens.accessToken;

      await db
        .update(calendarAccount)
        .set({
          encryptedCredentials: encryptCredentials({
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken ?? credentials.refreshToken,
            expiresIn: newTokens.expiresIn,
          }),
          tokenExpiresAt: new Date(Date.now() + newTokens.expiresIn * 1000),
        })
        .where(eq(calendarAccount.id, calendarAccountId));
    }

    const calendarService = new GoogleCalendarService(accessToken);

    // Best effort — don't fail if stop fails (channel may already be expired)
    try {
      await calendarService.stopWatch(
        calAccount.watchChannelId,
        calAccount.watchResourceId
      );
    } catch {
      // Ignore — channel may already be expired
    }

    // Clear watch fields
    await db
      .update(calendarAccount)
      .set({
        watchChannelId: null,
        watchResourceId: null,
        watchExpiration: null,
        syncToken: null,
      })
      .where(eq(calendarAccount.id, calendarAccountId));

    return ok({ stopped: true });
  } catch (error) {
    logError('calendar.stopCalendarWatch', error, {
      feature: 'calendar',
      extra: { calendarAccountId, organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to stop calendar watch'
      )
    );
  }
};

export const stopCalendarWatch = (
  db: DbConnection,
  input: StopCalendarWatchInput
) =>
  trackedResult(
    'calendar.stopCalendarWatch',
    () => withOrgScope((tx) => stopCalendarWatchImpl(tx, input), { db }),
    {
      properties: { calendarAccountId: input.calendarAccountId },
    }
  );

export type StopCalendarWatchResult = Awaited<
  ReturnType<typeof stopCalendarWatch>
>;
