import {
  bookingAccount,
  calendarAccount,
  organization,
  organizationLocation,
  organizationLocationOpeningHoursException,
  practitioner,
  practitionerService,
  withOrgScope,
} from '@borradh-workspace/database';
import type { WorkingHours } from '@borradh-workspace/database';
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
import {
  generateSlots,
  resolveAvailability,
  resolveOrgWideBlockedBusy,
} from '../../../scheduling/services/resolve-availability/index.js';
import {
  filterSlotsByResources,
  loadResourceGateContext,
} from '../../../scheduling/services/resolve-resource-availability/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  isCustomerBookable,
  notDeleted,
  ok,
  usesNativeCalendar,
  zonedDateString,
  zonedHourMinute,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';
import {
  type AvailableSlot,
  type CheckAvailabilityInput,
  type CheckAvailabilityResult,
  checkAvailabilitySchema,
} from './check-availability.schema.js';

/**
 * Time preference ranges in 24-hour format
 */
const TIME_PREFERENCES = {
  morning: { start: 8, end: 12 },
  afternoon: { start: 12, end: 17 },
  evening: { start: 17, end: 21 },
  any: { start: 8, end: 21 },
} as const;

/**
 * Format time for voice (e.g., "2:30 PM")
 */
function formatTimeForVoice(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayMinute = minute.toString().padStart(2, '0');
  return minute === 0
    ? `${displayHour} ${period}`
    : `${displayHour}:${displayMinute} ${period}`;
}

/**
 * Generate time slots for a date range excluding busy periods
 */
function generateAvailableSlots(
  date: string,
  busyPeriods: Array<{ start: string; end: string }>,
  durationMinutes: number,
  timePreference: 'morning' | 'afternoon' | 'evening' | 'any',
  _timezone: string
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const prefRange = TIME_PREFERENCES[timePreference];

  // Create date objects for the day
  const dayStart = new Date(
    `${date}T${prefRange.start.toString().padStart(2, '0')}:00:00`
  );
  const dayEnd = new Date(
    `${date}T${prefRange.end.toString().padStart(2, '0')}:00:00`
  );

  // Convert busy periods to Date objects for comparison
  const busyRanges = busyPeriods.map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  // Generate slots at 30-minute intervals
  const slotInterval = 30; // minutes
  let currentSlot = new Date(dayStart);

  while (currentSlot < dayEnd) {
    const slotEnd = new Date(
      currentSlot.getTime() + durationMinutes * 60 * 1000
    );

    // Check if slot would extend past day end
    if (slotEnd > dayEnd) break;

    // Check if slot overlaps with any busy period
    const isAvailable = !busyRanges.some(
      (busy) =>
        (currentSlot >= busy.start && currentSlot < busy.end) ||
        (slotEnd > busy.start && slotEnd <= busy.end) ||
        (currentSlot <= busy.start && slotEnd >= busy.end)
    );

    if (isAvailable) {
      const hour = currentSlot.getHours();
      const minute = currentSlot.getMinutes();

      slots.push({
        date,
        startTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        endTime: `${slotEnd.getHours().toString().padStart(2, '0')}:${slotEnd.getMinutes().toString().padStart(2, '0')}`,
        displayTime: formatTimeForVoice(hour, minute),
        isoStart: currentSlot.toISOString(),
        isoEnd: slotEnd.toISOString(),
      });
    }

    // Move to next slot
    currentSlot = new Date(currentSlot.getTime() + slotInterval * 60 * 1000);
  }

  return slots;
}

/**
 * Check availability via Google Calendar
 */
async function checkGoogleCalendarAvailability(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: CheckAvailabilityInput
): Promise<Result<CheckAvailabilityResult>> {
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

      // Update the stored credentials with new access token
      // Note: In production, you'd want to update the DB here
    }

    const calendarService = new GoogleCalendarService(accessToken);

    // Get free/busy for the requested date
    const dateStart = new Date(`${input.date}T00:00:00`);
    const dateEnd = new Date(`${input.date}T23:59:59`);

    const freeBusy = await calendarService.getFreeBusy(
      calAccount.calendarId,
      dateStart,
      dateEnd
    );

    const busyPeriods: { start: string; end: string }[] =
      freeBusy.calendars[calAccount.calendarId]?.busy || [];

    // Add org-wide blocked time. The Google path has no practitioner context,
    // so only org-wide blocks (zero practitioner joins) apply.
    const unavailability = await resolveOrgWideBlockedBusy(
      db,
      org.id,
      dateStart,
      dateEnd
    );
    for (const range of unavailability) {
      busyPeriods.push({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
    }

    // Get duration from org settings or input
    const duration = input.duration || org.defaultAppointmentDuration || 30;

    // Generate available slots
    const slots = generateAvailableSlots(
      input.date,
      busyPeriods,
      duration,
      input.timePreference || 'any',
      input.timezone || 'UTC'
    );

    // Build response message for voice
    let message: string;
    if (slots.length === 0) {
      message = `I'm sorry, there are no available appointments on ${input.date}. Would you like to check another day?`;
    } else if (slots.length === 1) {
      message = `I have one available slot on ${input.date} at ${slots[0].displayTime}. Would that work for you?`;
    } else {
      const topSlots = slots.slice(0, 3);
      const times = topSlots.map((s) => s.displayTime).join(', ');
      message = `I have ${slots.length} available slots on ${input.date}. The earliest times are ${times}. Which time works best for you?`;
    }

    return ok({
      available: slots.length > 0,
      slots,
      provider: 'google_calendar',
      message,
    });
  } catch (error) {
    logError('calendar.checkGoogleCalendarAvailability', error, {
      feature: 'calendar',
      extra: { organizationId: org.id, calendarAccountId: calAccount.id },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to check calendar availability. Please try again.'
      )
    );
  }
}

/**
 * Check availability via Calendly
 */
async function checkCalendlyAvailability(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: CheckAvailabilityInput
): Promise<Result<CheckAvailabilityResult>> {
  if (!org.primaryCalendarAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No primary calendar account configured for this organization.'
      )
    );
  }

  // Get the booking account
  const account = await db.query.bookingAccount.findFirst({
    where: eq(bookingAccount.id, org.primaryCalendarAccountId),
  });

  if (!account) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Calendly account not found. Please reconnect your Calendly account.'
      )
    );
  }

  if (!account.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Calendly account is not active. Please reconnect your Calendly account.'
      )
    );
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    }>(account.encryptedCredentials);

    let accessToken = credentials.accessToken;

    // Check if token is expired and refresh if needed
    if (
      account.tokenExpiresAt &&
      new Date() >= account.tokenExpiresAt &&
      credentials.refreshToken
    ) {
      const oauthService = new CalendlyOAuthService();
      const newTokens = await oauthService.refreshAccessToken(
        credentials.refreshToken
      );
      accessToken = newTokens.accessToken;
    }

    const apiService = new CalendlyApiService(accessToken);

    // Get the event type URI from config or use default
    const config = account.config?.calendly;
    const eventTypeUri = config?.defaultEventTypeUri;

    if (!eventTypeUri) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'No default event type configured for Calendly. Please set up your event type in settings.'
        )
      );
    }

    // Calculate date range (Calendly limits to 7 days per request)
    const startTime = new Date(`${input.date}T00:00:00Z`).toISOString();
    const endTime = new Date(`${input.date}T23:59:59Z`).toISOString();

    // Get available times from Calendly
    const availableTimes = await apiService.getAvailableTimes(
      eventTypeUri,
      startTime,
      endTime
    );

    // Org-wide blocked time. Calendly slots are pre-filtered by Calendly's own
    // availability rules, so we drop any slot that intersects a Borradh-side block.
    const unavailability = await resolveOrgWideBlockedBusy(
      db,
      org.id,
      new Date(startTime),
      new Date(endTime)
    );

    // Filter to only available slots and apply time preference
    const prefRange = TIME_PREFERENCES[input.timePreference || 'any'];
    const slots: AvailableSlot[] = availableTimes
      .filter((slot) => slot.status === 'available')
      .map((slot) => {
        const slotDate = new Date(slot.startTime);
        const hour = slotDate.getUTCHours();
        const minute = slotDate.getUTCMinutes();
        const duration = input.duration || org.defaultAppointmentDuration || 30;
        const endDate = new Date(slotDate.getTime() + duration * 60 * 1000);

        return {
          date: input.date,
          startTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
          endTime: `${endDate.getUTCHours().toString().padStart(2, '0')}:${endDate.getUTCMinutes().toString().padStart(2, '0')}`,
          displayTime: formatTimeForVoice(hour, minute),
          isoStart: slot.startTime,
          isoEnd: endDate.toISOString(),
        };
      })
      .filter((slot) => {
        const hour = Number.parseInt(slot.startTime.split(':')[0], 10);
        return hour >= prefRange.start && hour < prefRange.end;
      })
      .filter((slot) => {
        const slotStart = new Date(slot.isoStart).getTime();
        const slotEnd = new Date(slot.isoEnd).getTime();
        return !unavailability.some(
          (busy) =>
            slotStart < busy.end.getTime() && slotEnd > busy.start.getTime()
        );
      });

    // Build response message for voice
    let message: string;
    if (slots.length === 0) {
      message = `I'm sorry, there are no available appointments on ${input.date}. Would you like to check another day?`;
    } else if (slots.length === 1) {
      message = `I have one available slot on ${input.date} at ${slots[0].displayTime}. Would that work for you?`;
    } else {
      const topSlots = slots.slice(0, 3);
      const times = topSlots.map((s) => s.displayTime).join(', ');
      message = `I have ${slots.length} available slots on ${input.date}. The earliest times are ${times}. Which time works best for you?`;
    }

    return ok({
      available: slots.length > 0,
      slots,
      provider: 'calendly',
      message,
    });
  } catch (error) {
    logError('calendar.checkCalendlyAvailability', error, {
      feature: 'calendar',
      extra: { organizationId: org.id, accountId: account.id },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to check Calendly availability. Please try again.'
      )
    );
  }
}

/**
 * Check availability via Timely
 *
 * Note: Timely uses a time-tracking model, so we check for existing bookings
 * and return slots that don't conflict with scheduled events.
 */
async function checkTimelyAvailability(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: CheckAvailabilityInput
): Promise<Result<CheckAvailabilityResult>> {
  if (!org.primaryCalendarAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No primary calendar account configured for this organization.'
      )
    );
  }

  // Get the booking account
  const account = await db.query.bookingAccount.findFirst({
    where: eq(bookingAccount.id, org.primaryCalendarAccountId),
  });

  if (!account) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Timely account not found. Please reconnect your Timely account.'
      )
    );
  }

  if (!account.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Timely account is not active. Please reconnect your Timely account.'
      )
    );
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
    }>(account.encryptedCredentials);

    let accessToken = credentials.accessToken;

    // Check if token is expired and refresh if needed
    if (
      account.tokenExpiresAt &&
      new Date() >= account.tokenExpiresAt &&
      credentials.refreshToken
    ) {
      const oauthService = new TimelyOAuthService();
      const newTokens = await oauthService.refreshAccessToken(
        credentials.refreshToken
      );
      accessToken = newTokens.accessToken;
    }

    // Get account ID from config
    const config = account.config?.timely;
    const accountId = config?.accountId
      ? Number.parseInt(config.accountId, 10)
      : Number.parseInt(account.externalAccountId || '0', 10);

    if (!accountId) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'No Timely account ID configured. Please reconnect your Timely account.'
        )
      );
    }

    const oauthService = new TimelyOAuthService();

    // Get existing bookings for the date
    const bookings = await oauthService.getBookings(
      accessToken,
      accountId,
      input.date,
      input.date
    );

    // Convert bookings to busy periods
    const busyPeriods: { start: string; end: string }[] = bookings.map(
      (booking) => ({
        start: booking.startTime,
        end: booking.endTime,
      })
    );

    // Add org-wide blocked time (no practitioner context in the Timely path).
    const dayStart = new Date(`${input.date}T00:00:00`);
    const dayEnd = new Date(`${input.date}T23:59:59`);
    const unavailability = await resolveOrgWideBlockedBusy(
      db,
      org.id,
      dayStart,
      dayEnd
    );
    for (const range of unavailability) {
      busyPeriods.push({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
    }

    // Get duration from org settings or input
    const duration = input.duration || org.defaultAppointmentDuration || 30;

    // Generate available slots
    const slots = generateAvailableSlots(
      input.date,
      busyPeriods,
      duration,
      input.timePreference || 'any',
      input.timezone || 'UTC'
    );

    // Build response message for voice
    let message: string;
    if (slots.length === 0) {
      message = `I'm sorry, there are no available appointments on ${input.date}. Would you like to check another day?`;
    } else if (slots.length === 1) {
      message = `I have one available slot on ${input.date} at ${slots[0].displayTime}. Would that work for you?`;
    } else {
      const topSlots = slots.slice(0, 3);
      const times = topSlots.map((s) => s.displayTime).join(', ');
      message = `I have ${slots.length} available slots on ${input.date}. The earliest times are ${times}. Which time works best for you?`;
    }

    return ok({
      available: slots.length > 0,
      slots,
      provider: 'timely',
      message,
    });
  } catch (error) {
    logError('calendar.checkTimelyAvailability', error, {
      feature: 'calendar',
      extra: { organizationId: org.id, accountId: account.id },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to check Timely availability. Please try again.'
      )
    );
  }
}

/**
 * Check availability across all practitioners for a service.
 * Returns a voice-friendly response with practitioner names.
 */
async function checkPractitionerAvailability(
  db: DbConnection,
  org: typeof organization.$inferSelect,
  input: CheckAvailabilityInput
): Promise<Result<CheckAvailabilityResult>> {
  const serviceId = input.serviceId;

  // Which practitioners can take this booking?
  //
  // With a serviceId we use the ones linked to that service. Without one
  // (a native-calendar org asking "what have you got?" before a treatment has
  // been picked) we fall back to every active practitioner in the org, which
  // is the same set the org-wide calendar view uses. Previously this function
  // was only reachable via a serviceId and cast `input.serviceId as string`,
  // so an org-wide call queried `practitionerService.serviceId = undefined`
  // and always came back empty.
  const practitioners = serviceId
    ? (
        await db.query.practitionerService.findMany({
          where: eq(practitionerService.serviceId, serviceId),
          with: {
            practitioner: {
              with: { locations: true },
            },
          },
        })
      ).map((link) => link.practitioner)
    : await db.query.practitioner.findMany({
        where: eq(practitioner.organizationId, org.id),
        with: { locations: true },
      });

  const activePractitioners = practitioners.filter(
    (p) => p.organizationId === org.id && isCustomerBookable(p)
  );

  if (activePractitioners.length === 0) {
    return ok({
      available: false,
      slots: [],
      provider: 'borradh',
      message: serviceId
        ? `I'm sorry, there are no practitioners available for this service. Would you like to check something else?`
        : `I'm sorry, we don't have anyone available to take bookings at the moment. Would you like to check something else?`,
    });
  }

  const duration = input.duration || org.defaultAppointmentDuration || 30;
  const prefRange = TIME_PREFERENCES[input.timePreference || 'any'];
  const timeZone = org.timezone || 'UTC';
  // Day boundaries as the org-tz zoned day (same tz the working intervals are
  // converted with). Building these in server-local time misaligns the
  // busy-query window for non-UTC orgs and skips early-local-day conflicts.
  // Day boundaries as the org-tz zoned day (same tz the working intervals are
  // converted with). Building these in server-local time misaligns the
  // busy-query window for non-UTC orgs and skips early-local-day conflicts.
  const dayStart = zonedWallTimeToUtc(input.date, 0, timeZone);
  const dayEnd = zonedWallTimeToUtc(input.date, 24 * 60, timeZone);

  // Location opening hours + per-date exceptions — the calendar's source of
  // truth for when the business is open — so the bot agrees with the calendar.
  const primaryLocation = await db.query.organizationLocation.findFirst({
    where: and(
      eq(organizationLocation.organizationId, org.id),
      eq(organizationLocation.isPrimary, true)
    ),
    columns: { id: true, openingHours: true },
  });
  const openingHoursExceptions = primaryLocation
    ? await db.query.organizationLocationOpeningHoursException.findMany({
        where: and(
          eq(
            organizationLocationOpeningHoursException.locationId,
            primaryLocation.id
          ),
          eq(organizationLocationOpeningHoursException.date, input.date)
        ),
        columns: {
          date: true,
          closed: true,
          fromMinutes: true,
          toMinutes: true,
        },
      })
    : [];

  // Single source of truth: real availability (shifts → fallback static hours,
  // minus time off, blocked time, and existing appointments).
  const resolved = await resolveAvailability(db, {
    organizationId: org.id,
    practitionerIds: activePractitioners.map((p) => p.id),
    from: dayStart,
    to: dayEnd,
    timeZone,
    orgBusinessHours: org.businessHours as WorkingHours | null,
    locationOpeningHours:
      (primaryLocation?.openingHours as WorkingHours | null) ?? null,
    openingHoursExceptions,
    fallbackHours: activePractitioners.map((p) => ({
      practitionerId: p.id,
      workingHours: p.workingHours,
      locationWorkingHours:
        p.locations.length > 0 ? p.locations[0].workingHours : null,
    })),
  });
  const resolvedById = new Map(resolved.map((r) => [r.practitionerId, r]));

  // Resource gate (treatment room / laser / chair). A free practitioner is only
  // half the answer: three practitioners and two rooms can only run two
  // treatments at 14:00, and the bot must not quote the third.
  //
  // Loaded ONCE for the whole day, BEFORE the practitioner loop below — the
  // context spans [dayStart, dayEnd) for every practitioner and every per-slot
  // test against it is in-memory. Loading it inside the loop would re-query the
  // same window once per practitioner; per slot it would be a flat N+1.
  //
  // ZERO-COST ROLLOUT PATH: null means "no service in this cart requires a
  // resource", which is every org that has not configured one. Null skips the
  // filter entirely, so slot output is byte-identical to the pre-resources
  // behaviour. Without a `serviceId` there is no cart to have requirements, so
  // the lookup is not even attempted.
  const resourceContext = serviceId
    ? await loadResourceGateContext(db, {
        organizationId: org.id,
        // Single-service today; the array is what a multi-service cart fills in.
        serviceIds: [serviceId],
        from: dayStart,
        to: dayEnd,
        // The org's own zone (already resolved above) — resource working hours
        // are wall-clock and must never be read as UTC.
        timeZone,
        // Same primary location that bounds the opening hours above, so a room
        // pinned to another site is not offered for this one.
        locationId: primaryLocation?.id ?? null,
      })
    : null;

  // For each practitioner, generate slots within the requested time preference.
  // All wall-clock labelling/filtering is done in the org's time zone.
  const practitionerSlots: { name: string; slots: AvailableSlot[] }[] = [];

  for (const prac of activePractitioners) {
    const avail = resolvedById.get(prac.id);
    if (!avail) continue;

    // `now: epoch` preserves the prior behaviour of this path: it returns all
    // in-hours slots for the requested date without dropping earlier-in-the-day
    // times (the chatbot only ever queries future days).
    const practitionerFree = generateSlots(avail, duration, {
      now: new Date(0),
    });
    // Pure, in-memory drop of the slots no free eligible resource can serve.
    // The null check is the un-resourced org's untouched path.
    const slots: AvailableSlot[] = (
      resourceContext
        ? filterSlotsByResources(practitionerFree, resourceContext)
        : practitionerFree
    )
      .filter((slot) => {
        // Only keep slots that land on the requested date in the org time zone.
        // The busy window is the org-tz day, which can span two server-local
        // days in the resolver's day enumeration, so an adjacent day can leak in.
        if (zonedDateString(slot.start, timeZone) !== input.date) return false;
        // Keep slots that fall entirely within the preferred time window
        // (wall-clock, in the org time zone).
        const s = zonedHourMinute(slot.start, timeZone);
        const e = zonedHourMinute(slot.end, timeZone);
        const startMin = s.hour * 60 + s.minute;
        const endMin = e.hour * 60 + e.minute;
        return startMin >= prefRange.start * 60 && endMin <= prefRange.end * 60;
      })
      .map((slot) => {
        const s = zonedHourMinute(slot.start, timeZone);
        const e = zonedHourMinute(slot.end, timeZone);
        return {
          date: input.date,
          startTime: `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`,
          endTime: `${e.hour.toString().padStart(2, '0')}:${e.minute.toString().padStart(2, '0')}`,
          displayTime: formatTimeForVoice(s.hour, s.minute),
          isoStart: slot.start.toISOString(),
          isoEnd: slot.end.toISOString(),
          // Keep the owning practitioner on the slot. Without it a booking is
          // written with practitioner_id NULL, which cannot be subtracted from
          // anyone's availability — the taken time is then offered again.
          practitionerId: prac.id,
          practitionerName: prac.name,
        };
      });

    if (slots.length > 0) {
      practitionerSlots.push({ name: prac.name, slots });
    }
  }

  // Build voice-friendly response
  const allSlots = practitionerSlots.flatMap((p) => p.slots);
  // Deduplicate by time
  const uniqueSlots = new Map<string, AvailableSlot>();
  for (const slot of allSlots) {
    const key = slot.isoStart;
    if (!uniqueSlots.has(key)) {
      uniqueSlots.set(key, slot);
    }
  }
  const mergedSlots = Array.from(uniqueSlots.values()).sort(
    (a, b) => new Date(a.isoStart).getTime() - new Date(b.isoStart).getTime()
  );

  let message: string;
  if (mergedSlots.length === 0) {
    message = `I'm sorry, there are no available appointments on ${input.date}. Would you like to check another day?`;
  } else if (practitionerSlots.length === 1) {
    const p = practitionerSlots[0];
    const topSlots = p.slots.slice(0, 3);
    const times = topSlots.map((s) => s.displayTime).join(', ');
    message = `We have availability with ${p.name} on ${input.date} at ${times}. Would any of those work for you?`;
  } else {
    // Show one slot per practitioner
    const options = practitionerSlots
      .slice(0, 3)
      .map((p) => `${p.slots[0].displayTime} with ${p.name}`)
      .join(', ');
    message = `We have availability on ${input.date}: ${options}. Which time and practitioner works best for you?`;
  }

  return ok({
    available: mergedSlots.length > 0,
    slots: mergedSlots,
    provider: 'borradh',
    message,
  });
}

/**
 * Internal implementation of check availability
 */
const checkAvailabilityImpl = async (
  db: DbConnection,
  input: CheckAvailabilityInput
): Promise<Result<CheckAvailabilityResult>> => {
  const parsed = checkAvailabilitySchema.safeParse(input);
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

  // Practitioner/shift-based availability covers two cases:
  //  - a specific service was requested (any org), or
  //  - the org runs on the built-in calendar, where shift rows ARE the
  //    availability and there is no external account to consult.
  //
  // The second case used to fall through to the account check below and error
  // with "No primary calendar configured", because `primaryCalendarAccountId`
  // is only ever set by an external gcal-style link. That made availability
  // unresolvable for every built-in-calendar org unless a serviceId happened
  // to be supplied, which silently disabled in-chat booking. See ENG-500 for
  // the underlying data-model cleanup.
  if (parsed.data.serviceId || usesNativeCalendar(org)) {
    return checkPractitionerAvailability(db, org, parsed.data);
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
      return checkGoogleCalendarAvailability(db, org, parsed.data);

    case 'calendly':
      return checkCalendlyAvailability(db, org, parsed.data);

    case 'timely':
      return checkTimelyAvailability(db, org, parsed.data);

    case 'phorest':
    case 'fresha':
      // Phorest and Fresha are excluded from this implementation
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          `${org.primaryCalendarType} availability check is not yet implemented`
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
 * Check availability for appointments based on organization's primary calendar
 *
 * Routes to the appropriate calendar provider (Google Calendar, Calendly, etc.)
 * based on organization settings.
 */
export const checkAvailability = (
  db: DbConnection,
  input: CheckAvailabilityInput
) =>
  trackedResult(
    'calendar.checkAvailability',
    () => withOrgScope((tx) => checkAvailabilityImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, date: input.date },
    }
  );

export type CheckAvailabilityServiceResult = Awaited<
  ReturnType<typeof checkAvailability>
>;
