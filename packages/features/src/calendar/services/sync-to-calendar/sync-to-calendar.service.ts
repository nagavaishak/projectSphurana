import { createHash } from 'node:crypto';
import {
  appointment,
  calendarAccount,
  lead,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type SyncToCalendarInput,
  syncToCalendarSchema,
} from './sync-to-calendar.schema.js';

interface SyncResult {
  synced: boolean;
  externalEventId?: string;
}

/**
 * Derive a deterministic Google Calendar event id from the appointment id so
 * that a retried create (e.g. the event was created but the DB write recording
 * externalCalendarEventId failed) collides with the existing event (409) rather
 * than inserting a duplicate. Google event ids must be base32hex ([a-v0-9],
 * length 5–1024); a lowercase sha256 hex digest satisfies that charset.
 */
function deterministicEventId(appointmentId: string): string {
  return `appt${createHash('sha256').update(appointmentId).digest('hex')}`;
}

const syncToCalendarImpl = async (
  db: DbConnection,
  input: SyncToCalendarInput
): Promise<Result<SyncResult>> => {
  const parsed = syncToCalendarSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId, action } = parsed.data;

  // Fetch appointment with lead data
  const appt = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, appointmentId),
      eq(appointment.organizationId, organizationId),
      notDeleted(appointment)
    ),
  });

  if (!appt) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Appointment not found'));
  }

  // Resolve calendar account
  let calAccountId = appt.calendarAccountId;
  if (!calAccountId) {
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { primaryCalendarAccountId: true },
    });
    calAccountId = org?.primaryCalendarAccountId ?? null;
  }

  if (!calAccountId) {
    return ok({ synced: false });
  }

  const calAccount = await db.query.calendarAccount.findFirst({
    where: eq(calendarAccount.id, calAccountId),
  });

  if (!calAccount || !calAccount.isActive) {
    return ok({ synced: false });
  }

  // Fetch lead for event details
  const leadRecord = await db.query.lead.findFirst({
    where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
  });

  try {
    // Decrypt credentials and refresh token if needed
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

      // Persist refreshed token so subsequent calls don't need to refresh again
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
        .where(eq(calendarAccount.id, calAccountId));
    }

    const calendarService = new GoogleCalendarService(accessToken);
    const leadName = leadRecord
      ? `${leadRecord.firstName ?? ''} ${leadRecord.lastName ?? ''}`.trim()
      : 'Unknown';

    if (action === 'create') {
      const event = await calendarService.createEvent(calAccount.calendarId, {
        id: deterministicEventId(appointmentId),
        summary: `${appt.title} - ${leadName}`,
        description: appt.description ?? undefined,
        start: { dateTime: appt.startDate.toISOString() },
        end: { dateTime: appt.endDate.toISOString() },
      });

      // Save external event ID
      await db
        .update(appointment)
        .set({ externalCalendarEventId: event.id })
        .where(and(eq(appointment.id, appointmentId), notDeleted(appointment)));

      return ok({ synced: true, externalEventId: event.id });
    }

    if (action === 'update') {
      if (appt.externalCalendarEventId) {
        await calendarService.updateEvent(
          calAccount.calendarId,
          appt.externalCalendarEventId,
          {
            summary: `${appt.title} - ${leadName}`,
            description: appt.description ?? undefined,
            start: { dateTime: appt.startDate.toISOString() },
            end: { dateTime: appt.endDate.toISOString() },
          }
        );

        return ok({
          synced: true,
          externalEventId: appt.externalCalendarEventId,
        });
      }

      // No external event yet — create one (e.g. appointment existed before calendar was connected)
      const event = await calendarService.createEvent(calAccount.calendarId, {
        id: deterministicEventId(appointmentId),
        summary: `${appt.title} - ${leadName}`,
        description: appt.description ?? undefined,
        start: { dateTime: appt.startDate.toISOString() },
        end: { dateTime: appt.endDate.toISOString() },
      });

      await db
        .update(appointment)
        .set({ externalCalendarEventId: event.id })
        .where(and(eq(appointment.id, appointmentId), notDeleted(appointment)));

      return ok({ synced: true, externalEventId: event.id });
    }

    if (action === 'delete' && appt.externalCalendarEventId) {
      await calendarService.deleteEvent(
        calAccount.calendarId,
        appt.externalCalendarEventId
      );

      return ok({
        synced: true,
        externalEventId: appt.externalCalendarEventId,
      });
    }

    return ok({ synced: false });
  } catch (error) {
    logError('calendar.syncToCalendar', error, {
      feature: 'calendar',
      extra: { appointmentId, action, calendarAccountId: calAccountId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to sync to calendar')
    );
  }
};

export const syncToCalendar = (db: DbConnection, input: SyncToCalendarInput) =>
  trackedResult(
    'calendar.syncToCalendar',
    () => withOrgScope((tx) => syncToCalendarImpl(tx, input), { db }),
    {
      properties: {
        appointmentId: input.appointmentId,
        action: input.action,
      },
    }
  );

export type SyncToCalendarResult = Awaited<ReturnType<typeof syncToCalendar>>;
