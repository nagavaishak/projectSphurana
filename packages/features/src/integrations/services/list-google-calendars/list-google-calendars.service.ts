import { calendarAccount, withOrgScope } from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
} from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListGoogleCalendarsInput,
  listGoogleCalendarsSchema,
} from './list-google-calendars.schema.js';

export interface GoogleCalendarItem {
  id: string;
  summary: string;
  description?: string;
  timeZone: string;
  primary: boolean;
  accessRole: string;
}

const listGoogleCalendarsImpl = async (
  db: DbConnection,
  input: ListGoogleCalendarsInput
): Promise<Result<GoogleCalendarItem[]>> => {
  const parsed = listGoogleCalendarsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  // Find the calendar account
  const account = await db.query.calendarAccount.findFirst({
    where: and(
      eq(calendarAccount.id, accountId),
      eq(calendarAccount.organizationId, organizationId)
    ),
  });

  if (!account) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Calendar account not found')
    );
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    }>(account.encryptedCredentials);

    let { accessToken } = credentials;

    // Refresh token if expired or close to expiring
    const isExpired =
      account.tokenExpiresAt && account.tokenExpiresAt <= new Date();
    if (isExpired && credentials.refreshToken) {
      const calendarOAuth = new GoogleCalendarOAuthService();
      const refreshed = await calendarOAuth.refreshAccessToken(
        credentials.refreshToken
      );
      accessToken = refreshed.accessToken;
    }

    // Fetch calendars
    const calendarService = new GoogleCalendarService(accessToken);
    const calendars = await calendarService.listCalendars();

    // Filter to writable calendars only
    const writable = calendars.filter(
      (cal) => cal.accessRole === 'writer' || cal.accessRole === 'owner'
    );

    return ok(writable);
  } catch (error) {
    logError('integrations.listGoogleCalendars', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list Google calendars'
      )
    );
  }
};

export const listGoogleCalendars = (
  db: DbConnection,
  input: ListGoogleCalendarsInput
) =>
  trackedResult(
    'integrations.listGoogleCalendars',
    () => withOrgScope((tx) => listGoogleCalendarsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        accountId: input.accountId,
      },
    }
  );

export type ListGoogleCalendarsResult = Awaited<
  ReturnType<typeof listGoogleCalendars>
>;
