import { randomInt } from 'node:crypto';
import {
  appointment,
  bookingAccount,
  calendarAccount,
  lead,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  CalendlyApiService,
  CalendlyOAuthService,
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  TimelyOAuthService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { resolveDefaultLocation } from '../../../organization-locations/index.js';
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
  type BookAppointmentInput,
  type BookAppointmentResult,
  bookAppointmentSchema,
} from './book-appointment.schema.js';

/**
 * Format time for voice (e.g., "2:30 PM")
 */
function formatTimeForVoice(time: string): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);

  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayMinute = minute.toString().padStart(2, '0');

  return minute === 0
    ? `${displayHour} ${period}`
    : `${displayHour}:${displayMinute} ${period}`;
}

/**
 * Name the booked day back to the caller, e.g. "Friday, August 14".
 *
 * `timeZone: 'UTC'` here is deliberate and is NOT the usual server-zone bug.
 * `input.date` is a bare `YYYY-MM-DD` wall-clock date the caller just said out
 * loud, and `new Date('2026-08-14')` anchors it at UTC MIDNIGHT. Rendering that
 * instant in the org's zone would move it: `America/New_York` reads it as the
 * evening of the 13th, so a caller who booked Friday would be read back
 * "Thursday, August 13". Formatting in UTC is what makes the string a faithful
 * echo of the date supplied, which is the only correct answer for a value that
 * never carried a zone in the first place.
 *
 * Its sibling `formatTimeForVoice` is zone-free for the same reason: it echoes
 * `input.time` verbatim rather than deriving a clock face from an instant.
 */
function formatVoiceBookingDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Generate a confirmation code
 */
function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'APT-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  return code;
}

/**
 * Book appointment via Google Calendar
 */
async function bookGoogleCalendarAppointment(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: BookAppointmentInput
): Promise<Result<BookAppointmentResult>> {
  if (!org.primaryCalendarAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No primary calendar account configured for this organization.'
      )
    );
  }

  // Get the calendar account
  const calAccount = await db.query.calendarAccount.findFirst({
    where: eq(calendarAccount.id, org.primaryCalendarAccountId),
  });

  if (!calAccount) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Calendar account not found. Please reconnect your Google Calendar.'
      )
    );
  }

  if (!calAccount.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Calendar account is not active. Please reconnect your Google Calendar.'
      )
    );
  }

  // Verify lead exists
  const leadRecord = await db.query.lead.findFirst({
    where: and(eq(lead.id, input.leadId), notDeleted(lead)),
  });

  if (!leadRecord) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    }>(calAccount.encryptedCredentials);

    let accessToken = credentials.accessToken;

    // Check if token is expired and refresh if needed
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
    }

    const calendarService = new GoogleCalendarService(accessToken);

    // Calculate appointment times
    const duration = input.duration || org.defaultAppointmentDuration || 30;
    const startDateTime = new Date(`${input.date}T${input.time}:00`);
    const endDateTime = new Date(
      startDateTime.getTime() + duration * 60 * 1000
    );

    // Create Google Calendar event
    const calendarEvent = await calendarService.createEvent(
      calAccount.calendarId,
      {
        summary: `${input.serviceType} - ${input.customerName}`,
        description: [
          `Customer: ${input.customerName}`,
          `Phone: ${input.customerPhone}`,
          input.customerEmail ? `Email: ${input.customerEmail}` : '',
          input.notes ? `Notes: ${input.notes}` : '',
          '',
          'Booked via AI Voice Assistant',
        ]
          .filter(Boolean)
          .join('\n'),
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'UTC',
        },
        attendees: input.customerEmail
          ? [{ email: input.customerEmail, displayName: input.customerName }]
          : undefined,
      }
    );

    // Generate confirmation code
    const confirmationCode = generateConfirmationCode();

    // Which branch this booking lands at. A voice call carries no branch of
    // its own (one number per org), so it goes to the org's default. A NULL
    // here would make the appointment invisible on every branch-scoped
    // calendar — booked, and nowhere a human looks.
    const defaultLocationId =
      (await resolveDefaultLocation(db, input.organizationId))?.id ?? null;

    // Create appointment record in database
    const [appointmentRecord] = await db
      .insert(appointment)
      .values({
        title: `${input.serviceType} - ${input.customerName}`,
        description: input.notes,
        startDate: startDateTime,
        endDate: endDateTime,
        status: 'booked',
        source: input.source || 'ai_voice_caller',
        color: 'blue',
        leadId: input.leadId,
        assignedToId: input.assignedToId,
        organizationId: input.organizationId,
        locationId: defaultLocationId,
        calendarAccountId: calAccount.id,
        externalCalendarEventId: calendarEvent.id,
      })
      .returning();

    const displayTime = formatTimeForVoice(input.time);
    const dateDisplay = formatVoiceBookingDate(input.date);

    return ok({
      success: true,
      appointmentId: appointmentRecord.id,
      confirmationCode,
      date: input.date,
      time: displayTime,
      serviceType: input.serviceType,
      externalEventId: calendarEvent.id,
      message: `Your appointment for ${input.serviceType} has been confirmed for ${dateDisplay} at ${displayTime}. Your confirmation code is ${confirmationCode}.`,
    });
  } catch (error) {
    logError('calendar.bookGoogleCalendarAppointment', error, {
      feature: 'calendar',
      extra: {
        organizationId: org.id,
        calendarAccountId: calAccount.id,
        date: input.date,
        time: input.time,
      },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to book the appointment. Please try again.'
      )
    );
  }
}

/**
 * Book appointment via Calendly
 */
async function bookCalendlyAppointment(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: BookAppointmentInput
): Promise<Result<BookAppointmentResult>> {
  if (!org.primaryCalendarAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No primary calendar account configured for this organization.'
      )
    );
  }

  // Get the booking account
  const bookingAcct = await db.query.bookingAccount.findFirst({
    where: eq(bookingAccount.id, org.primaryCalendarAccountId),
  });

  if (!bookingAcct) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Calendly account not found. Please reconnect your Calendly integration.'
      )
    );
  }

  if (!bookingAcct.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Calendly account is not active. Please reconnect your integration.'
      )
    );
  }

  // Verify lead exists
  const leadRecord = await db.query.lead.findFirst({
    where: and(eq(lead.id, input.leadId), notDeleted(lead)),
  });

  if (!leadRecord) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
  }

  // Get default event type from config
  const config = bookingAcct.config as {
    calendly?: { defaultEventTypeUri?: string };
  } | null;
  const eventTypeUri = config?.calendly?.defaultEventTypeUri;

  if (!eventTypeUri) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No default event type configured for Calendly. Please configure your booking settings.'
      )
    );
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
    }>(bookingAcct.encryptedCredentials);

    let accessToken = credentials.accessToken;

    // Check if token is expired and refresh if needed
    if (
      bookingAcct.tokenExpiresAt &&
      new Date() >= bookingAcct.tokenExpiresAt &&
      credentials.refreshToken
    ) {
      const oauthService = new CalendlyOAuthService();
      const newTokens = await oauthService.refreshAccessToken(
        credentials.refreshToken
      );
      accessToken = newTokens.accessToken;
    }

    const calendlyService = new CalendlyApiService(accessToken);

    // Create the scheduled event in Calendly
    const startTime = new Date(`${input.date}T${input.time}:00`).toISOString();

    const scheduledEvent = await calendlyService.createScheduledEvent({
      eventTypeUri,
      startTime,
      invitee: {
        email: input.customerEmail || `${input.customerPhone}@placeholder.com`,
        name: input.customerName,
        timezone: 'UTC',
      },
    });

    // Generate confirmation code
    const confirmationCode = generateConfirmationCode();

    // Calculate end time from scheduled event
    const startDateTime = new Date(scheduledEvent.startTime);
    const endDateTime = new Date(scheduledEvent.endTime);

    // Which branch this booking lands at. A voice call carries no branch of
    // its own (one number per org), so it goes to the org's default. A NULL
    // here would make the appointment invisible on every branch-scoped
    // calendar — booked, and nowhere a human looks.
    const defaultLocationId =
      (await resolveDefaultLocation(db, input.organizationId))?.id ?? null;

    // Create appointment record in database
    const [appointmentRecord] = await db
      .insert(appointment)
      .values({
        title: `${input.serviceType} - ${input.customerName}`,
        description: input.notes,
        startDate: startDateTime,
        endDate: endDateTime,
        status: 'booked',
        source: input.source || 'ai_voice_caller',
        color: 'purple',
        leadId: input.leadId,
        assignedToId: input.assignedToId,
        organizationId: input.organizationId,
        locationId: defaultLocationId,
        calendarAccountId: bookingAcct.id,
        externalCalendarEventId: scheduledEvent.uri,
      })
      .returning();

    const displayTime = formatTimeForVoice(input.time);
    const dateDisplay = formatVoiceBookingDate(input.date);

    return ok({
      success: true,
      appointmentId: appointmentRecord.id,
      confirmationCode,
      date: input.date,
      time: displayTime,
      serviceType: input.serviceType,
      externalEventId: scheduledEvent.uri,
      message: `Your appointment for ${input.serviceType} has been confirmed for ${dateDisplay} at ${displayTime}. Your confirmation code is ${confirmationCode}.`,
    });
  } catch (error) {
    logError('calendar.bookCalendlyAppointment', error, {
      feature: 'calendar',
      extra: {
        organizationId: org.id,
        bookingAccountId: bookingAcct.id,
        date: input.date,
        time: input.time,
      },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to book the appointment via Calendly. Please try again.'
      )
    );
  }
}

/**
 * Book appointment via Timely
 */
async function bookTimelyAppointment(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: BookAppointmentInput
): Promise<Result<BookAppointmentResult>> {
  if (!org.primaryCalendarAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No primary calendar account configured for this organization.'
      )
    );
  }

  // Get the booking account
  const bookingAcct = await db.query.bookingAccount.findFirst({
    where: eq(bookingAccount.id, org.primaryCalendarAccountId),
  });

  if (!bookingAcct) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Timely account not found. Please reconnect your Timely integration.'
      )
    );
  }

  if (!bookingAcct.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Timely account is not active. Please reconnect your integration.'
      )
    );
  }

  // Verify lead exists
  const leadRecord = await db.query.lead.findFirst({
    where: and(eq(lead.id, input.leadId), notDeleted(lead)),
  });

  if (!leadRecord) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
  }

  // Get accountId and default projectId from config
  const config = bookingAcct.config as {
    timely?: { accountId?: number; defaultProjectId?: number };
  } | null;
  const accountId = config?.timely?.accountId;
  const projectId = config?.timely?.defaultProjectId;

  if (!accountId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Timely account ID not configured. Please reconnect your integration.'
      )
    );
  }

  if (!projectId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No default project configured for Timely. Please configure your booking settings.'
      )
    );
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
    }>(bookingAcct.encryptedCredentials);

    let accessToken = credentials.accessToken;

    // Check if token is expired and refresh if needed
    const timelyService = new TimelyOAuthService();
    if (
      bookingAcct.tokenExpiresAt &&
      new Date() >= bookingAcct.tokenExpiresAt &&
      credentials.refreshToken
    ) {
      const newTokens = await timelyService.refreshAccessToken(
        credentials.refreshToken
      );
      accessToken = newTokens.accessToken;
    }

    // Calculate times
    const duration = input.duration || org.defaultAppointmentDuration || 30;
    const startDateTime = new Date(`${input.date}T${input.time}:00`);
    const endDateTime = new Date(
      startDateTime.getTime() + duration * 60 * 1000
    );

    // Format times for Timely (HH:MM format)
    const fromTime = input.time;
    const toTime = `${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`;

    // Create the booking in Timely
    const timelyBooking = await timelyService.createBooking(
      accessToken,
      accountId,
      {
        projectId,
        day: input.date,
        from: fromTime,
        to: toTime,
        note: [
          `${input.serviceType} - ${input.customerName}`,
          `Phone: ${input.customerPhone}`,
          input.customerEmail ? `Email: ${input.customerEmail}` : '',
          input.notes ? `Notes: ${input.notes}` : '',
          'Booked via AI Voice Assistant',
        ]
          .filter(Boolean)
          .join('\n'),
      }
    );

    // Generate confirmation code
    const confirmationCode = generateConfirmationCode();

    // Which branch this booking lands at. A voice call carries no branch of
    // its own (one number per org), so it goes to the org's default. A NULL
    // here would make the appointment invisible on every branch-scoped
    // calendar — booked, and nowhere a human looks.
    const defaultLocationId =
      (await resolveDefaultLocation(db, input.organizationId))?.id ?? null;

    // Create appointment record in database
    const [appointmentRecord] = await db
      .insert(appointment)
      .values({
        title: `${input.serviceType} - ${input.customerName}`,
        description: input.notes,
        startDate: startDateTime,
        endDate: endDateTime,
        status: 'booked',
        source: input.source || 'ai_voice_caller',
        color: 'green',
        leadId: input.leadId,
        assignedToId: input.assignedToId,
        organizationId: input.organizationId,
        locationId: defaultLocationId,
        calendarAccountId: bookingAcct.id,
        externalCalendarEventId: timelyBooking.id.toString(),
      })
      .returning();

    const displayTime = formatTimeForVoice(input.time);
    const dateDisplay = formatVoiceBookingDate(input.date);

    return ok({
      success: true,
      appointmentId: appointmentRecord.id,
      confirmationCode,
      date: input.date,
      time: displayTime,
      serviceType: input.serviceType,
      externalEventId: timelyBooking.id.toString(),
      message: `Your appointment for ${input.serviceType} has been confirmed for ${dateDisplay} at ${displayTime}. Your confirmation code is ${confirmationCode}.`,
    });
  } catch (error) {
    logError('calendar.bookTimelyAppointment', error, {
      feature: 'calendar',
      extra: {
        organizationId: org.id,
        bookingAccountId: bookingAcct.id,
        date: input.date,
        time: input.time,
      },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to book the appointment via Timely. Please try again.'
      )
    );
  }
}

/**
 * Internal implementation of book appointment
 */
const bookAppointmentImpl = async (
  db: DbConnection,
  input: BookAppointmentInput
): Promise<Result<BookAppointmentResult>> => {
  const parsed = bookAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Get organization with calendar settings
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // Check if primary calendar is configured
  if (!org.primaryCalendarType || !org.primaryCalendarAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No primary calendar configured. Please set up your calendar integration in settings.'
      )
    );
  }

  // Route to appropriate provider
  switch (org.primaryCalendarType) {
    case 'google_calendar':
      return bookGoogleCalendarAppointment(db, org, parsed.data);

    case 'calendly':
      return bookCalendlyAppointment(db, org, parsed.data);

    case 'timely':
      return bookTimelyAppointment(db, org, parsed.data);

    case 'phorest':
    case 'fresha':
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          `${org.primaryCalendarType} booking is not yet implemented`
        )
      );

    default:
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Unknown calendar provider: ${org.primaryCalendarType}`
        )
      );
  }
};

/**
 * Book an appointment via the organization's primary calendar
 *
 * Creates an event in the calendar and stores the appointment in the database.
 */
export const bookAppointment = (
  db: DbConnection,
  input: BookAppointmentInput
) =>
  trackedResult(
    'calendar.bookAppointment',
    () => withOrgScope((tx) => bookAppointmentImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        date: input.date,
        time: input.time,
      },
    }
  );

export type BookAppointmentServiceResult = Awaited<
  ReturnType<typeof bookAppointment>
>;
