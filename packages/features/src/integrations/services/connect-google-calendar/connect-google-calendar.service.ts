import {
  type CalendarAccount,
  calendarAccount,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
} from '@borradh-workspace/integrations';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { startCalendarWatch } from '../../../calendar/services/start-calendar-watch/start-calendar-watch.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectGoogleCalendarInput,
  connectGoogleCalendarSchema,
} from './connect-google-calendar.schema.js';

/**
 * Internal implementation of connect Google Calendar
 */
const connectGoogleCalendarImpl = async (
  db: DbConnection,
  input: ConnectGoogleCalendarInput
): Promise<Result<CalendarAccount>> => {
  const parsed = connectGoogleCalendarSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code } = parsed.data;

  try {
    const calendarOAuth = new GoogleCalendarOAuthService();
    const tokens = await calendarOAuth.exchangeCodeForTokens(code);
    const userInfo = await calendarOAuth.getUserInfo(tokens.accessToken);

    // Check if already connected
    const existing = await db.query.calendarAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.email, userInfo.email)),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Calendar ${userInfo.email} is already connected`
        )
      );
    }

    // Create a dedicated "Borradh" calendar for this organization
    const calendarService = new GoogleCalendarService(tokens.accessToken);
    const borradhCalendar = await calendarService.createCalendar('Borradh');

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    });

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Store in database
    const [result] = await db
      .insert(calendarAccount)
      .values({
        organizationId,
        userId,
        email: userInfo.email,
        displayName: userInfo.name,
        calendarId: borradhCalendar.id,
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
        syncEnabled: true,
      })
      .returning();

    // Set as the organization's primary calendar so bookings sync to Google Calendar
    await db
      .update(organization)
      .set({
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: result.id,
      })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );

    // Start push notification watch (best effort — don't fail connect if watch fails)
    try {
      await startCalendarWatch(db, {
        calendarAccountId: result.id,
        organizationId,
      });
    } catch {
      // Watch can be set up later by the scheduler
    }

    return ok(result);
  } catch (error) {
    logError('integrations.connectGoogleCalendar', error, {
      feature: 'integrations',
      extra: { organizationId, userId },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to connect Google Calendar. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Google Calendar'
      )
    );
  }
};

/**
 * Connect a Google Calendar to an organization
 */
export const connectGoogleCalendar = (
  db: DbConnection,
  input: ConnectGoogleCalendarInput
) =>
  trackedResult(
    'integrations.connectGoogleCalendar',
    () => withOrgScope((tx) => connectGoogleCalendarImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ConnectGoogleCalendarResult = Awaited<
  ReturnType<typeof connectGoogleCalendar>
>;
