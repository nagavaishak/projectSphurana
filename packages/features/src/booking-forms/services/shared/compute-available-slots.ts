import { calendarAccount } from '@borradh-workspace/database';
import type { WorkingHours } from '@borradh-workspace/database';
import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type AvailabilityBusyRange,
  type OpeningHoursException,
  generateSlots,
  resolveAvailability,
} from '../../../scheduling/services/resolve-availability/index.js';
import {
  filterSlotsByResources,
  loadResourceGateContext,
} from '../../../scheduling/services/resolve-resource-availability/index.js';

/**
 * The org's location opening hours + per-date exceptions, resolved once by the
 * caller and passed into slot computation so bookable times honour the location
 * schedule (the calendar's source of truth) — not just org business hours.
 */
export interface LocationHours {
  openingHours: WorkingHours | null;
  exceptions: OpeningHoursException[];
}
import type { DbConnection } from '../../../shared/index.js';
import type {
  AvailableSlot,
  PractitionerAvailability,
} from '../../models/index.js';

interface GoogleCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface PractitionerInfo {
  id: string;
  name: string;
  photo: string | null;
  title: string | null;
  calendarAccountId: string | null;
  workingHours: WorkingHours | null;
  locationWorkingHours: WorkingHours | null;
}

/**
 * The cart being priced for availability, so slots can also be gated on a free
 * treatment room / laser / chair — not just a free practitioner.
 *
 * OMITTING this is the pre-resources behaviour, exactly. It is optional so the
 * one thing that must never change (an org with no resources configured) needs
 * no caller change at all.
 */
export interface ResourceGateOptions {
  /**
   * EVERY service in the cart, not just the primary one. A cart needing a room
   * AND a laser must satisfy both, so a caller holding one service passes
   * `[serviceId]` rather than dropping the field.
   */
  serviceIds: string[];
  /** Location the booking is for — a resource pinned to another location must not be offered. */
  locationId?: string | null;
  /** Reschedules: the appointment being moved must not conflict with its own holds. */
  excludeAppointmentIds?: string[];
}

export async function getGoogleCalendarBusyTimes(
  db: DbConnection,
  calAccountId: string,
  startDate: Date,
  endDate: Date
): Promise<{ start: Date; end: Date }[]> {
  const calAccount = await db.query.calendarAccount.findFirst({
    where: and(
      eq(calendarAccount.id, calAccountId),
      eq(calendarAccount.isActive, true),
      eq(calendarAccount.syncEnabled, true)
    ),
  });

  if (!calAccount) return [];

  const credentials = decryptCredentials<GoogleCredentials>(
    calAccount.encryptedCredentials
  );

  let accessToken = credentials.accessToken;

  if (calAccount.tokenExpiresAt && calAccount.tokenExpiresAt < new Date()) {
    const oauthService = new GoogleCalendarOAuthService();
    const refreshed = await oauthService.refreshAccessToken(
      credentials.refreshToken
    );
    accessToken = refreshed.accessToken;
  }

  const calendarService = new GoogleCalendarService(accessToken);
  const freeBusy = await calendarService.getFreeBusy(
    calAccount.calendarId,
    startDate,
    endDate
  );

  const calendarBusy = freeBusy.calendars[calAccount.calendarId]?.busy || [];
  return calendarBusy.map((b: { start: string; end: string }) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));
}

/**
 * Merge slots from multiple practitioners and deduplicate by time range.
 */
export function mergeSlots(allSlots: AvailableSlot[][]): AvailableSlot[] {
  const seen = new Map<string, AvailableSlot>();
  for (const slots of allSlots) {
    for (const slot of slots) {
      const key = `${slot.startTime.getTime()}-${slot.endTime.getTime()}`;
      if (!seen.has(key)) {
        seen.set(key, slot);
      }
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );
}

/**
 * Compute available slots for a list of practitioners.
 * This is the core slot computation logic shared between form-based and general booking.
 */
export async function computePractitionerSlots(
  db: DbConnection,
  practitioners: PractitionerInfo[],
  orgId: string,
  orgBusinessHours: WorkingHours | null,
  timeZone: string,
  startDate: Date,
  endDate: Date,
  slotDuration: number,
  logPrefix: string,
  locationHours?: LocationHours,
  /**
   * The branch these slots are for. Handed straight to `resolveAvailability`,
   * which has always filtered shifts by location and never received one — so a
   * practitioner rostered only at Cork counted as available in Dublin.
   * Undefined keeps the org-wide behaviour (an org with no branches).
   *
   * Also the default branch for `resourceGate` below, so a room pinned to
   * another branch cannot make a slot here look bookable.
   */
  locationId?: string,
  resourceGate?: ResourceGateOptions
): Promise<{
  byPractitioner: PractitionerAvailability[];
  merged: AvailableSlot[];
}> {
  // External (Google Calendar) busy is fetched here — it needs the integrations
  // client + per-practitioner calendarAccountId — and handed to the resolver.
  const additionalBusyByPractitioner: Record<string, AvailabilityBusyRange[]> =
    {};
  for (const prac of practitioners) {
    if (!prac.calendarAccountId) continue;
    try {
      const calBusy = await getGoogleCalendarBusyTimes(
        db,
        prac.calendarAccountId,
        startDate,
        endDate
      );
      if (calBusy.length > 0) {
        additionalBusyByPractitioner[prac.id] = calBusy;
      }
    } catch (error) {
      logError(`${logPrefix}.calendarBusy`, error, {
        feature: 'booking-forms',
        extra: { practitionerId: prac.id },
      });
    }
  }

  // Single source of truth: shifts minus time off, blocked time, appointments,
  // and the external busy gathered above. A practitioner with no shifts yields
  // no slots — org/location opening hours never make them bookable (they're
  // display-only). The opening-hours args below are ignored by the resolver;
  // kept until callers stop passing them.
  const resolved = await resolveAvailability(db, {
    organizationId: orgId,
    practitionerIds: practitioners.map((p) => p.id),
    from: startDate,
    to: endDate,
    timeZone,
    locationId,
    orgBusinessHours,
    locationOpeningHours: locationHours?.openingHours ?? null,
    openingHoursExceptions: locationHours?.exceptions,
    fallbackHours: practitioners.map((p) => ({
      practitionerId: p.id,
      workingHours: p.workingHours,
      locationWorkingHours: p.locationWorkingHours,
    })),
    additionalBusyByPractitioner,
  });
  const resolvedById = new Map(resolved.map((r) => [r.practitionerId, r]));

  // ── Resource gate (rooms / equipment) ─────────────────────────────────────
  // Loaded ONCE for the whole window, BEFORE the practitioner loop. The context
  // covers [startDate, endDate) for every practitioner, and every per-slot test
  // below is pure in-memory arithmetic against it. Loading inside the loop (let
  // alone per slot) would be an N+1 against the DB on the public booking page's
  // hottest read.
  //
  // ZERO-COST ROLLOUT PATH: `loadResourceGateContext` returns null when no
  // service in the cart has a single requirement row — which is every org that
  // has never configured a resource, i.e. all of them today. Null short-circuits
  // to `null` here and `filterSlotsByResources` is never reached, so slot output
  // is byte-identical to the pre-resources behaviour. Callers that pass no
  // `resourceGate` at all skip even the lookup.
  //
  // SECURITY: on the public widget this runs as `app_public`, which holds SELECT
  // on only a narrow column set of the resource tables (migration
  // 0090_narrow_public_availability_grants.sql / 0148). The loader does its own
  // column narrowing — do NOT widen it from here. A missing grant raises
  // "permission denied", and the callers of this function swallow a throw into
  // an EMPTY-SLOTS result, so a grant mistake DISABLES gating silently instead
  // of failing loudly. Treat any resource-related empty-slots report as a grant
  // question first.
  const resourceContext =
    resourceGate && resourceGate.serviceIds.length > 0
      ? await loadResourceGateContext(db, {
          organizationId: orgId,
          serviceIds: resourceGate.serviceIds,
          from: startDate,
          to: endDate,
          // The org's zone, resolved by the caller — resource working hours are
          // wall-clock and must not be read as UTC.
          timeZone,
          // Falls back to the branch the SLOTS are for. Before the two
          // features met, `resourceGate.locationId` was the only branch signal
          // and callers that had one passed it here; callers that now pass
          // `locationId` positionally would otherwise gate rooms org-wide and
          // offer a slot held only by the other building's room.
          locationId: resourceGate.locationId ?? locationId,
          excludeAppointmentIds: resourceGate.excludeAppointmentIds,
        })
      : null;

  const byPractitioner: PractitionerAvailability[] = [];
  for (const prac of practitioners) {
    const avail = resolvedById.get(prac.id);
    if (!avail) continue;
    const practitionerSlots = generateSlots(avail, slotDuration);
    // `filterSlotsByResources` is pure and in-memory; the null check above is
    // what keeps the un-resourced org on exactly its old code path.
    const gated = resourceContext
      ? filterSlotsByResources(practitionerSlots, resourceContext)
      : practitionerSlots;
    const slots = gated.map((s) => ({
      startTime: s.start,
      endTime: s.end,
    }));

    if (slots.length > 0) {
      byPractitioner.push({
        practitioner: {
          id: prac.id,
          name: prac.name,
          photo: prac.photo,
          title: prac.title,
        },
        slots,
      });
    }
  }

  const merged = mergeSlots(byPractitioner.map((p) => p.slots));

  return { byPractitioner, merged };
}
