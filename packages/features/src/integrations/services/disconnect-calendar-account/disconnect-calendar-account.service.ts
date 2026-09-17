import {
  calendarAccount,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { stopCalendarWatch } from '../../../calendar/services/stop-calendar-watch/stop-calendar-watch.service.js';
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
  type DisconnectCalendarAccountInput,
  disconnectCalendarAccountSchema,
} from './disconnect-calendar-account.schema.js';

/**
 * Internal implementation of disconnect calendar account
 */
const disconnectCalendarAccountImpl = async (
  db: DbConnection,
  input: DisconnectCalendarAccountInput
): Promise<Result<{ success: boolean }>> => {
  const parsed = disconnectCalendarAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    // Verify account belongs to organization
    const existing = await db.query.calendarAccount.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, accountId), eqOp(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Calendar account not found')
      );
    }

    // Stop watch channel (best effort)
    try {
      await stopCalendarWatch(db, {
        calendarAccountId: accountId,
        organizationId,
      });
    } catch {
      // Ignore — channel may already be expired
    }

    // Delete the dedicated Borradh calendar from Google (best effort)
    try {
      const credentials = decryptCredentials<{
        accessToken: string;
        refreshToken?: string;
        expiresIn: number;
      }>(existing.encryptedCredentials);

      let accessToken = credentials.accessToken;

      if (
        existing.tokenExpiresAt &&
        new Date() >= existing.tokenExpiresAt &&
        credentials.refreshToken
      ) {
        const oauthService = new GoogleCalendarOAuthService();
        const newTokens = await oauthService.refreshAccessToken(
          credentials.refreshToken
        );
        accessToken = newTokens.accessToken;
      }

      const calendarService = new GoogleCalendarService(accessToken);
      await calendarService.deleteCalendar(existing.calendarId);
    } catch {
      // Don't fail disconnect if calendar deletion fails
    }

    // Delete the account
    await db
      .delete(calendarAccount)
      .where(
        and(
          eq(calendarAccount.id, accountId),
          eq(calendarAccount.organizationId, organizationId)
        )
      );

    // Clear the organization's primary calendar if this was the active one
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { primaryCalendarAccountId: true },
    });

    if (org?.primaryCalendarAccountId === accountId) {
      await db
        .update(organization)
        .set({
          primaryCalendarType: null,
          primaryCalendarAccountId: null,
        })
        .where(
          and(eq(organization.id, organizationId), notDeleted(organization))
        );
    }

    return ok({ success: true });
  } catch (error) {
    logError('integrations.disconnectCalendarAccount', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect calendar account'
      )
    );
  }
};

/**
 * Disconnect a calendar account from an organization
 */
export const disconnectCalendarAccount = (
  db: DbConnection,
  input: DisconnectCalendarAccountInput
) =>
  trackedResult(
    'integrations.disconnectCalendarAccount',
    () =>
      withOrgScope((tx) => disconnectCalendarAccountImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectCalendarAccountResult = Awaited<
  ReturnType<typeof disconnectCalendarAccount>
>;
