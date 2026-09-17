import { randomUUID } from 'node:crypto';
import { calendarAccount, withOrgScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
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
  type StartCalendarWatchInput,
  startCalendarWatchSchema,
} from './start-calendar-watch.schema.js';

interface StartWatchResult {
  watchChannelId: string;
  watchResourceId: string;
  watchExpiration: Date;
}

const startCalendarWatchImpl = async (
  db: DbConnection,
  input: StartCalendarWatchInput
): Promise<Result<StartWatchResult>> => {
  const parsed = startCalendarWatchSchema.safeParse(input);
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

  if (!calAccount.isActive || !calAccount.syncEnabled) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Calendar account is not active or sync is disabled'
      )
    );
  }

  try {
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    }>(calAccount.encryptedCredentials);

    let accessToken = credentials.accessToken;

    // Refresh token if expired
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
    const channelId = randomUUID();

    const apiUrl = apiEnv.API_URL;
    if (!apiUrl) {
      return err(
        new FeatureError(ErrorCodes.VALIDATION_ERROR, 'API_URL not configured')
      );
    }

    const webhookUrl = `${apiUrl}/webhooks/google-calendar`;
    const webhookToken = apiEnv.GOOGLE_CALENDAR_WEBHOOK_TOKEN;

    // Set up the watch channel
    const watchResult = await calendarService.watchEvents(
      calAccount.calendarId,
      channelId,
      webhookUrl,
      webhookToken
    );

    // Do an initial sync to get the first syncToken
    const syncResult = await calendarService.listEventsWithSyncToken(
      calAccount.calendarId
    );

    const watchExpiration = new Date(Number(watchResult.expiration));

    // Save watch details and syncToken
    await db
      .update(calendarAccount)
      .set({
        watchChannelId: channelId,
        watchResourceId: watchResult.resourceId,
        watchExpiration,
        syncToken: syncResult.nextSyncToken || null,
        lastSyncAt: new Date(),
      })
      .where(eq(calendarAccount.id, calendarAccountId));

    return ok({
      watchChannelId: channelId,
      watchResourceId: watchResult.resourceId,
      watchExpiration,
    });
  } catch (error) {
    logError('calendar.startCalendarWatch', error, {
      feature: 'calendar',
      extra: { calendarAccountId, organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to start calendar watch'
      )
    );
  }
};

export const startCalendarWatch = (
  db: DbConnection,
  input: StartCalendarWatchInput
) =>
  trackedResult(
    'calendar.startCalendarWatch',
    () => withOrgScope((tx) => startCalendarWatchImpl(tx, input), { db }),
    {
      properties: { calendarAccountId: input.calendarAccountId },
    }
  );

export type StartCalendarWatchResult = Awaited<
  ReturnType<typeof startCalendarWatch>
>;
