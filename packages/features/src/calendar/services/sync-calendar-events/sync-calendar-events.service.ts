import { appointment, calendarAccount } from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import type { GoogleCalendarEvent } from '@borradh-workspace/integrations';
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
  type SyncCalendarEventsInput,
  syncCalendarEventsSchema,
} from './sync-calendar-events.schema.js';

interface SyncResult {
  updated: number;
  cancelled: number;
}

const syncCalendarEventsImpl = async (
  db: DbConnection,
  input: SyncCalendarEventsInput
): Promise<Result<SyncResult>> => {
  const parsed = syncCalendarEventsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { calendarAccountId } = parsed.data;

  const calAccount = await db.query.calendarAccount.findFirst({
    where: eq(calendarAccount.id, calendarAccountId),
  });

  if (!calAccount) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Calendar account not found')
    );
  }

  if (!calAccount.isActive) {
    return ok({ updated: 0, cancelled: 0 });
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

    // Fetch incremental changes using syncToken
    let syncResult = await calendarService.listEventsWithSyncToken(
      calAccount.calendarId,
      calAccount.syncToken ?? undefined
    );

    // If syncToken expired, do a full re-sync
    if (syncResult.fullSyncRequired) {
      syncResult = await calendarService.listEventsWithSyncToken(
        calAccount.calendarId
      );
    }

    let updated = 0;
    let cancelled = 0;

    // Process each changed event
    for (const event of syncResult.events) {
      const result = await processChangedEvent(db, calAccount.id, event);
      if (result === 'updated') updated++;
      if (result === 'cancelled') cancelled++;
    }

    // Save new syncToken and lastSyncAt
    await db
      .update(calendarAccount)
      .set({
        syncToken: syncResult.nextSyncToken || calAccount.syncToken,
        lastSyncAt: new Date(),
      })
      .where(eq(calendarAccount.id, calendarAccountId));

    return ok({ updated, cancelled });
  } catch (error) {
    logError('calendar.syncCalendarEvents', error, {
      feature: 'calendar',
      extra: { calendarAccountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to sync calendar events'
      )
    );
  }
};

/**
 * Process a single changed event from Google Calendar.
 * Since we use a dedicated Borradh calendar, every event in it is ours.
 */
async function processChangedEvent(
  db: DbConnection,
  calendarAccountId: string,
  event: GoogleCalendarEvent
): Promise<'updated' | 'cancelled' | 'skipped'> {
  // Find the local appointment matching this external event ID
  const localAppointment = await db.query.appointment.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull }) =>
      andOp(
        eqOp(t.externalCalendarEventId, event.id),
        eqOp(t.calendarAccountId, calendarAccountId),
        isNull(t.deletedAt)
      ),
  });

  if (!localAppointment) {
    // No matching local appointment — skip
    return 'skipped';
  }

  if (event.status === 'cancelled') {
    // Event was deleted in Google Calendar — cancel the local appointment
    if (localAppointment.status !== 'cancelled') {
      await db
        .update(appointment)
        .set({ status: 'cancelled' })
        .where(
          and(eq(appointment.id, localAppointment.id), notDeleted(appointment))
        );
      return 'cancelled';
    }
    return 'skipped';
  }

  // Event was updated — sync title and time back
  const startDateTime = event.start?.dateTime || event.start?.date;
  const endDateTime = event.end?.dateTime || event.end?.date;

  if (!startDateTime || !endDateTime) {
    return 'skipped';
  }

  const newStart = new Date(startDateTime);
  const newEnd = new Date(endDateTime);

  // Only update if something actually changed
  const titleChanged = event.summary !== localAppointment.title;
  const startChanged =
    newStart.getTime() !== localAppointment.startDate.getTime();
  const endChanged = newEnd.getTime() !== localAppointment.endDate.getTime();
  const descriptionChanged =
    (event.description ?? null) !== localAppointment.description;

  if (titleChanged || startChanged || endChanged || descriptionChanged) {
    await db
      .update(appointment)
      .set({
        title: event.summary || localAppointment.title,
        startDate: newStart,
        endDate: newEnd,
        description: event.description ?? localAppointment.description,
      })
      .where(
        and(eq(appointment.id, localAppointment.id), notDeleted(appointment))
      );
    return 'updated';
  }

  return 'skipped';
}

export const syncCalendarEvents = (
  db: DbConnection,
  input: SyncCalendarEventsInput
) =>
  trackedResult(
    'calendar.syncCalendarEvents',
    () => syncCalendarEventsImpl(db, input),
    {
      properties: { calendarAccountId: input.calendarAccountId },
    }
  );

export type SyncCalendarEventsResult = Awaited<
  ReturnType<typeof syncCalendarEvents>
>;
