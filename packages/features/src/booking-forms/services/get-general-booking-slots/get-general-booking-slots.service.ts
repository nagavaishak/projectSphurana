import {
  organization,
  organizationLocationOpeningHoursException,
  organizationService,
  practitioner,
  practitionerLocation,
  practitionerService,
} from '@borradh-workspace/database';
import type { WorkingHours } from '@borradh-workspace/database';
import { withPublicOrgScope } from '@borradh-workspace/database';
import { resolveAppointmentDuration } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { and, between, eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  getBookingLocationById,
  resolveBookingLocation,
} from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  customerBookablePractitioner,
  err,
  isCustomerBookable,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { AvailableSlotsResponse } from '../../models/index.js';
import { computePractitionerSlots } from '../shared/index.js';
import type { PractitionerInfo } from '../shared/index.js';
import {
  type GetGeneralBookingSlotsInput,
  getGeneralBookingSlotsSchema,
} from './get-general-booking-slots.schema.js';

// Slot length is NOT a booking-page policy: it is the service's duration,
// resolved through the one canonical ladder in
// `resolveAppointmentDuration` (service → org default → 30). This file used to
// own a private `DEFAULT_SLOT_DURATION = 30` while the staff calendar owned a
// private 60, which is how the same null-duration service became a 30-minute
// slot to a customer and a 60-minute block to the clinic (ENG-793).

// Short TTL: availability recomputes are expensive (DB scoped reads + live
// Google free/busy calls per practitioner) and the public booking page hits this
// on every load, month-page, and practitioner toggle. A brief cache collapses a
// thundering herd on a popular org into one compute per window. Staleness is
// bounded and safe: a slot booked within the TTL is still rejected at write time
// by the appointment_no_overlap exclusion constraint (clean CONFLICT), so a
// customer can never actually double-book a cached-but-taken slot.
/**
 * The cache namespace, EXPORTED so nothing has to hardcode the version.
 *
 * Bumping this is how a shape change invalidates old entries, and the version
 * has already moved once (v1 → v2, when the key gained a branch). Anything that
 * needs to clear these keys — the integration suite does, between a booking and
 * a re-read — must derive the prefix from here. A hardcoded copy is invisible
 * when the version moves: the clear silently matches nothing, the stale entry
 * survives, and the re-read returns the PRE-booking slot list. That is exactly
 * what happened, and it was read as "resource gating does not remove slots" —
 * a phantom bug on the money path that the gate never had.
 */
export const SLOTS_CACHE_PREFIX = 'booking:slots:v2';

const SLOTS_CACHE_TTL_SECONDS = 45;

function slotsCacheKey(input: GetGeneralBookingSlotsInput): string {
  const {
    organizationSlug,
    serviceId,
    startDate,
    endDate,
    practitionerId,
    locationSlug,
    locationId,
  } = input;
  // The branch is part of the key, not a detail: two branches of the same org
  // compute different availability from the same (org, service, day), so a
  // branch-blind key would serve Cork whatever Dublin asked for 45 seconds ago.
  //
  // Both addressing modes are keyed, and keyed DISTINGUISHABLY (`id:` prefix).
  // The slug and the id of one branch are different strings for the same
  // availability, so they take two cache slots — a duplicate compute, never a
  // wrong answer. Collapsing them would mean resolving the branch before the
  // cache read, which is the DB work the cache exists to avoid.
  return [
    SLOTS_CACHE_PREFIX,
    organizationSlug,
    locationId ? `id:${locationId}` : (locationSlug ?? 'default'),
    serviceId,
    practitionerId ?? 'any',
    startDate.toISOString(),
    endDate.toISOString(),
  ].join(':');
}

function tryGetRedis(): ReturnType<typeof getRedis> | null {
  try {
    return getRedis();
  } catch {
    // Redis not configured (e.g. dev without REDIS_URL) — skip caching entirely.
    return null;
  }
}

/** Revive Date fields that JSON.parse turned back into ISO strings. */
function reviveSlots(response: AvailableSlotsResponse): AvailableSlotsResponse {
  const reviveList = (
    slots: { startTime: string | Date; endTime: string | Date }[]
  ) =>
    slots.map((s) => ({
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
    }));
  return {
    slots: reviveList(response.slots),
    byPractitioner: response.byPractitioner?.map((p) => ({
      practitioner: p.practitioner,
      slots: reviveList(p.slots),
    })),
  };
}

const getGeneralBookingSlotsImpl = async (
  db: DbConnection,
  input: GetGeneralBookingSlotsInput
): Promise<Result<AvailableSlotsResponse>> => {
  const parsed = getGeneralBookingSlotsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationSlug,
    serviceId,
    startDate,
    endDate,
    practitionerId,
    locationSlug,
    locationId,
  } = parsed.data;

  // The two addressing modes name one thing, so accepting both would mean
  // choosing which one to believe — and the caller that passes both has a bug
  // we would be hiding. Refuse instead of ranking them.
  if (locationSlug && locationId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Pass either locationSlug or locationId, not both'
      )
    );
  }

  // Validate date range (max 30 days)
  const daysDiff = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysDiff > 30) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Date range cannot exceed 30 days'
      )
    );
  }

  // ── Cache read (before any DB work) ───────────────────────────────────────
  // On a hit we return immediately — no scoped DB connection is held and no
  // Google free/busy calls are made. Cache is best-effort: any Redis failure
  // falls through to a normal compute.
  const cacheKey = slotsCacheKey(parsed.data);
  const redis = tryGetRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return ok(reviveSlots(JSON.parse(cached) as AvailableSlotsResponse));
      }
    } catch (error) {
      logError('bookingForms.getGeneralBookingSlots.cacheRead', error, {
        feature: 'booking-forms',
        extra: { cacheKey },
      });
    }
  }

  // ── Slug bootstrap (runs OUTSIDE withPublicOrgScope) ──────────────────────
  // Resolve slug → org_id before org context exists. The slug_bootstrap policy
  // on `organization` permits this unscoped SELECT for app_public. MUST be
  // outside any withPublicOrgScope call (chicken-and-egg: can't set
  // app.current_org_id until we know the org id).
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // ── Scoped reads (runs INSIDE withPublicOrgScope) ─────────────────────────
  // All subsequent queries are scoped to org.id via SET LOCAL app.current_org_id.
  // The org_isolation policy on each Bucket A table enforces this at the DB
  // level — even if a WHERE clause were tampered, the policy restricts results.
  //
  // ALWAYS pass { db } so we use the injected connection (the app_public pool
  // wired in Phase 2 / I3, or the test mock db). Omitting { db } would fall
  // back to the global db, breaking pool separation and test isolation.
  const scopedResult = await withPublicOrgScope(
    org.id,
    async (tx) => {
      // Find the service (org_isolation policy ensures it belongs to this org)
      const service = await tx.query.organizationService.findFirst({
        where: and(
          eq(organizationService.id, serviceId),
          eq(organizationService.organizationId, org.id),
          eq(organizationService.isActive, true)
        ),
      });

      if (!service) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found')
        ) as Result<AvailableSlotsResponse>;
      }

      const slotDuration = resolveAppointmentDuration(
        service.appointmentDuration,
        org.defaultAppointmentDuration
      );

      // Which branch these times are for — resolved BEFORE the practitioner
      // and hours lookups, because every one of them is branch-dependent. The
      // slug names it; absent, the org's DEFAULT branch, which is the branch
      // `getGeneralBookingConfig` priced against and `submitGeneralBooking`
      // stamps. This used to be a hard `isPrimary = true` filter, so every
      // branch was offered the primary branch's hours and bank-holiday
      // closures.
      const location = locationId
        ? await getBookingLocationById(tx, org.id, locationId)
        : await resolveBookingLocation(tx, org.id, locationSlug);
      // Either addressing mode NAMED a branch. If it did not resolve, the
      // branch is gone or belongs to another org — serving the default one
      // instead would answer a question nobody asked, which for the
      // id-addressed caller means offering another branch's diary for a
      // booking that will stay on this one.
      if ((locationSlug || locationId) && !location) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
        ) as Result<AvailableSlotsResponse>;
      }

      // "Works at this branch, or is assigned to no branch at all" — the same
      // predicate the dashboard's practitioner list uses. Zero
      // `practitioner_location` rows still means every branch, so an org that
      // has never assigned anyone is unaffected.
      const atThisBranch = (entityId: PgColumn) =>
        location
          ? [
              atLocationOrUnassigned(
                tx,
                practitionerLocation,
                practitionerLocation.practitionerId,
                entityId,
                practitionerLocation.locationId,
                location.id
              ),
            ]
          : [];

      // Get practitioners assigned to this service AND to this branch.
      const serviceLinks = await tx.query.practitionerService.findMany({
        where: and(
          eq(practitionerService.serviceId, serviceId),
          ...atThisBranch(practitionerService.practitionerId)
        ),
        with: {
          practitioner: {
            with: {
              locations: true,
            },
          },
        },
      });

      const toPractitionerInfo = (p: {
        id: string;
        name: string;
        photo: string | null;
        title: string | null;
        calendarAccountId: string | null;
        workingHours: WorkingHours | null;
        locations: { locationId: string; workingHours: WorkingHours | null }[];
      }): PractitionerInfo => ({
        id: p.id,
        name: p.name,
        photo: p.photo,
        title: p.title,
        calendarAccountId: p.calendarAccountId,
        workingHours: p.workingHours,
        // The row for THE BRANCH BEING BOOKED. This took `locations[0]` — an
        // arbitrary `practitioner_location` row, i.e. whichever branch the DB
        // happened to return first — so a Cork booking could be shaped by
        // Dublin's per-branch hours. No branch resolved (an org mid-onboarding
        // with no locations) means no per-branch row can exist either, so null
        // is the same answer `locations[0]` gave on an empty list.
        locationWorkingHours: location
          ? (p.locations.find((l) => l.locationId === location.id)
              ?.workingHours ?? null)
          : null,
      });

      let practitioners: PractitionerInfo[] = serviceLinks
        .map((link) => link.practitioner)
        .filter((p) => p.organizationId === org.id && isCustomerBookable(p))
        .map(toPractitionerInfo);

      // A service with no practitioner links is not evidence that the org runs
      // without practitioners — far more often it is a service someone added
      // without assigning anyone. Falling straight through to the org-hours
      // legacy path there is a correctness bug: that path knows nothing about
      // shifts, so a practitioner's day-off override is invisible and the page
      // keeps offering a day they marked as not working. Use the org's active
      // practitioners instead, which is exactly what the chatbot's availability
      // check already does. The legacy path then only serves orgs that genuinely
      // have no practitioners at all.
      if (practitioners.length === 0) {
        const orgPractitioners = await tx.query.practitioner.findMany({
          where: and(
            eq(practitioner.organizationId, org.id),
            customerBookablePractitioner(),
            ...atThisBranch(practitioner.id)
          ),
          with: { locations: true },
        });
        practitioners = orgPractitioners.map(toPractitionerInfo);
      }

      // Filter to specific practitioner if requested
      if (practitionerId) {
        practitioners = practitioners.filter((p) => p.id === practitionerId);
        if (practitioners.length === 0) {
          return err(
            new FeatureError(
              ErrorCodes.NOT_FOUND,
              'Practitioner not found or not available for this service'
            )
          ) as Result<AvailableSlotsResponse>;
        }
      }

      // Opening hours + per-date exceptions for THE RESOLVED BRANCH (the
      // calendar's source of truth for when that address is open), so bookable
      // times honour the branch schedule — not just org business hours, and
      // not the primary branch's Christmas closure applied to every branch.
      const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
      const openingHoursExceptions = location
        ? await tx.query.organizationLocationOpeningHoursException.findMany({
            where: and(
              eq(
                organizationLocationOpeningHoursException.locationId,
                location.id
              ),
              between(
                organizationLocationOpeningHoursException.date,
                toDateStr(new Date(startDate.getTime() - 86_400_000)),
                toDateStr(new Date(endDate.getTime() + 86_400_000))
              )
            ),
            columns: {
              date: true,
              closed: true,
              fromMinutes: true,
              toMinutes: true,
            },
          })
        : [];
      const locationHours = {
        openingHours: location?.openingHours ?? null,
        exceptions: openingHoursExceptions,
      };

      // Slot computation is best-effort for this PUBLIC, unauthenticated read.
      // An org with no calendar / availability configured (or a transient
      // failure in a downstream busy-time lookup) should surface as "no slots",
      // never a 500 on the public booking widget. Known errors (missing org /
      // service / practitioner) are still returned as proper Results above.
      try {
        // No practitioners at all = no availability. There is deliberately no
        // second, org-hours-based code path here any more: it could not see
        // `shift` rows, so a practitioner's day-off override was invisible to it
        // and the page went on offering days the business had marked as closed.
        // Every org now gets a practitioner on create (ensureDefaultPractitioner),
        // so this is the genuinely-unconfigured case, and an empty list is the
        // honest answer.
        if (practitioners.length === 0) {
          return ok({ slots: [] }) as Result<AvailableSlotsResponse>;
        }

        // Compute practitioner-based slots.
        // computePractitionerSlots reads calendar_account + appointment — both
        // granted to app_public with the necessary permissions.
        const { byPractitioner, merged } = await computePractitionerSlots(
          tx,
          practitioners,
          org.id,
          org.businessHours as WorkingHours | null,
          org.timezone || 'UTC',
          startDate,
          endDate,
          slotDuration,
          'bookingForms.getGeneralBookingSlots',
          locationHours,
          // The resolver has filtered shifts by location since it was written;
          // nobody passed the argument, so a Cork-only shift counted as
          // availability in Dublin. This is the caller finally passing it.
          location?.id,
          // Resource gate. This widget sells ONE service at a time, so the cart
          // is `[serviceId]` — the array shape is what a multi-service cart will
          // fill in without changing this contract. The location is the SAME
          // resolved branch whose opening hours bound the slots above (it was
          // `primaryLocation` before the branch resolver existed), so a room
          // pinned elsewhere cannot be offered here.
          //
          // Costs nothing for an org with no resources: the loader returns null
          // on its first (indexed, empty) requirement lookup and slot output is
          // unchanged. See the SECURITY note in computePractitionerSlots — the
          // reads it makes are `app_public`-granted (migration 0148), and a
          // missing grant would surface here as empty slots, not an error.
          {
            serviceIds: [serviceId],
            locationId: location?.id ?? null,
          }
        );

        const response: AvailableSlotsResponse = {
          slots: merged,
        };

        // Include per-practitioner breakdown (general booking always allows selection)
        if (byPractitioner.length > 1) {
          response.byPractitioner = byPractitioner;
        }

        return ok(response) as Result<AvailableSlotsResponse>;
      } catch (error) {
        logError('bookingForms.getGeneralBookingSlots.compute', error, {
          feature: 'booking-forms',
          extra: { organizationId: org.id, serviceId },
        });
        return ok({ slots: [] }) as Result<AvailableSlotsResponse>;
      }
    },
    { db }
  );

  // ── Cache write (only successful computes) ────────────────────────────────
  if (redis && scopedResult.success) {
    try {
      await redis.set(
        cacheKey,
        JSON.stringify(scopedResult.data),
        'EX',
        SLOTS_CACHE_TTL_SECONDS
      );
    } catch (error) {
      logError('bookingForms.getGeneralBookingSlots.cacheWrite', error, {
        feature: 'booking-forms',
        extra: { cacheKey },
      });
    }
  }

  return scopedResult;
};

export const getGeneralBookingSlots = (
  db: DbConnection,
  input: GetGeneralBookingSlotsInput
) =>
  trackedResult(
    'bookingForms.getGeneralBookingSlots',
    () => getGeneralBookingSlotsImpl(db, input),
    {
      properties: {
        organizationSlug: input.organizationSlug,
        serviceId: input.serviceId,
        locationSlug: input.locationSlug,
        locationId: input.locationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetGeneralBookingSlotsResult = Awaited<
  ReturnType<typeof getGeneralBookingSlots>
>;
