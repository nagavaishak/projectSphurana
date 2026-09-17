import {
  appointment,
  appointmentResource,
  appointmentService,
  isDeadlock,
  isExclusionViolation,
  orgDefaults,
  organization,
  organizationService,
  resource,
  resourceCategory,
  serviceResourceEligibility,
  serviceResourceRequirement,
} from '@borradh-workspace/database';
import {
  type ResourceAssignmentMode,
  resourceAssignmentModeValues,
} from '@borradh-workspace/labels';
import { logError } from '@borradh-workspace/observability';
import { and, eq, gt, inArray, lt, notInArray } from 'drizzle-orm';
// Through the scheduling domain's PUBLIC barrel, not a deep path into its
// internals — `architecture/context-boundaries.test.ts` enforces this.
import {
  loadResourceGateContext,
  pickResourcesFor,
} from '../../../scheduling/index.js';
import {
  type DbConnection,
  type ErrorCode,
  ErrorCodes,
  FeatureError,
  atLocationOrUnscoped,
  notDeleted,
} from '../../../shared/index.js';
import { releaseAppointmentResources } from './release-appointment-resources.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Resource allocation for an appointment (rooms, lasers, chairs).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This sits ALONGSIDE the existing practitioner-conflict logic in
 * `create-appointment` / `update-appointment` and mirrors its `isManual` split
 * exactly:
 *
 *   - ONLINE (`source !== 'manual'`) — hard block. A customer must never be
 *     handed a slot the clinic cannot physically run.
 *   - MANUAL / console — warn, don't block. Staff already double-book
 *     practitioners and book outside posted hours; taking that freedom away for
 *     rooms would make the console worse than the paper diary it replaced.
 *
 * ─── THE ROLLOUT-SAFETY GUARANTEE ─────────────────────────────────────────
 * `loadResourceGateContext` returns null when NO service in the cart has a
 * single requirement row. Every entry point here returns immediately on null,
 * BEFORE reading org defaults, resources or allocations. An org that never sets
 * a room up therefore pays exactly one indexed lookup that finds nothing, and
 * gets byte-identical behaviour to before this feature existed.
 *
 * That early return is deliberately the first statement of every public
 * function in this file, not a condition threaded through the body — the only
 * way to bypass it is to delete it. The ONE thing ahead of it is the explicit
 * -picks branch in `allocateAppointmentResources`, which an org with no
 * resources can never enter (it has nothing to pick), so the guarantee holds.
 */

/**
 * Plan cap for `organization_service.turnaround_minutes` (0–240, multiples of
 * 5). Used to size the availability window BEFORE the cart's real turnaround is
 * known — over-fetching the window is free (the busy set is filtered by
 * overlap anyway), under-fetching would silently miss a conflicting hold.
 */
const MAX_TURNAROUND_MINUTES = 240;

const MS_PER_DAY = 24 * 60 * 60_000;

/**
 * Midnight UTC on the day containing `at`, and midnight UTC on the day after.
 *
 * UTC, deliberately: `pickResourcesFor` buckets its per-day load counts by UTC
 * day too, so the window that FEEDS the count and the count itself have to
 * agree on where a day begins. A clinic whose local day straddles the UTC
 * boundary gets its load bucketed slightly differently from the way it reads
 * the diary — harmless for a tie-break, and much worse than harmless if the
 * two halves disagreed.
 */
const startOfUtcDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

const endOfUtcDay = (at: Date): Date =>
  new Date(startOfUtcDay(at).getTime() + MS_PER_DAY);

const EMPTY_RESULT: AllocateAppointmentResourcesResult = Object.freeze({
  allocated: [],
  warnings: [],
});

/** A resource held for the appointment, as reported back to the caller. */
export interface AllocatedResource {
  categoryId: string;
  resourceId: string;
}

/**
 * "We booked you a room, but it is already taken." Produced ONLY on the
 * manual/console path — an online booking that cannot get a room is refused
 * outright, never warned about.
 *
 * `resourceId` / `resourceName` are nullable for the one case where there is
 * nothing at all to name: a required category that contains zero usable
 * resources. The UI still needs to say "no room was assigned", so the warning
 * is emitted rather than swallowed.
 */
export interface ResourceWarning {
  categoryId: string;
  categoryName: string;
  resourceId: string | null;
  resourceName: string | null;
  conflictingAppointmentTitle: string | null;
  conflictStart: Date | null;
  conflictEnd: Date | null;
}

export interface AllocateAppointmentResourcesResult {
  allocated: AllocatedResource[];
  warnings: ResourceWarning[];
}

export interface AllocateAppointmentResourcesInput {
  organizationId: string;
  appointmentId: string;
  /** The cart's service ids. Empty ⇒ nothing can be required ⇒ zero-cost path. */
  serviceIds: string[];
  startDate: Date;
  endDate: Date;
  /** IANA zone (organization.timezone) — resource working hours resolve in it. */
  timeZone: string;
  locationId?: string | null;
  /** `appointment.source === 'manual'` — the console/front-desk path. */
  isManual: boolean;
  /**
   * `org_defaults.resource_assignment_mode`. OPTIONAL on purpose: when omitted
   * it is resolved lazily, AFTER the zero-cost check has already returned. A
   * required field would force every caller to read `org_defaults` on every
   * booking — including the overwhelming majority of orgs that have never
   * created a room — which is exactly the cost the zero-cost path exists to
   * avoid.
   */
  assignmentMode?: ResourceAssignmentMode;
  /** Staff-chosen resources. Honoured verbatim and stored as `source: 'manual'`. */
  explicitResourceIds?: string[];
  /**
   * The operator was shown the clash and chose to book anyway.
   *
   * Only meaningful alongside `explicitResourceIds`: an AUTO allocation never
   * needs it, because the allocator already warns-don't-blocks on the console
   * path. What it unlocks is the case the allocator cannot decide for anyone —
   * "put her in Room 2, I know it is taken, I will sort it out."
   *
   * IGNORED for anything that is not a console booking. A customer on the
   * public booking page must never be able to send a flag that double-books a
   * clinic, whatever the client does.
   */
  allowResourceOverbook?: boolean;
  /** A reschedule must not conflict with its own existing allocations. */
  excludeAppointmentIds?: string[];
  /**
   * Overrides the block/warn decision `isManual` implies.
   *
   * `'warn'` exists for RE-allocation after a write has already landed (an
   * update/reschedule): the appointment has moved, and refusing at that point
   * would leave the row rescheduled holding nothing, with no clean way back.
   * The PRE-write gate (`checkAppointmentResourcesAvailable`) is what blocks
   * those paths; this one records reality and warns.
   */
  unavailableBehaviour?: 'block' | 'warn';
}

/**
 * Signal raised by `allocateAppointmentResources`, for the calling service to
 * turn into a `FeatureError`. Thrown rather than returned so a caller CANNOT
 * ignore it and commit a booking the clinic has no room for.
 */
export class ResourceAllocationError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ResourceAllocationError';
    this.code = code;
    this.details = details;
  }

  toFeatureError(): FeatureError {
    return new FeatureError(this.code, this.message, this.details);
  }
}

/** `error instanceof ResourceAllocationError ? error.toFeatureError() : null`. */
export const asResourceFeatureError = (error: unknown): FeatureError | null =>
  error instanceof ResourceAllocationError ? error.toFeatureError() : null;

// ── Org setting ─────────────────────────────────────────────────────────────

/**
 * `org_defaults.resource_assignment_mode`, defaulting to `'auto'` when unset or
 * unrecognised.
 *
 * Read straight off the table rather than through `getOrgDefaults`: that
 * resolver's `OrgDefaults` model does not carry this field (it resolves the
 * Claire/ads/wage/gift-card defaults), and widening it belongs to the
 * org-defaults feature, not here. Same precedent as
 * `timesheets/list-auto-clock-candidates`, which documents the identical
 * choice.
 */
export async function resolveResourceAssignmentMode(
  db: DbConnection,
  organizationId: string
): Promise<ResourceAssignmentMode> {
  const row = await db.query.orgDefaults.findFirst({
    where: eq(orgDefaults.organizationId, organizationId),
    columns: { resourceAssignmentMode: true },
  });
  const mode = row?.resourceAssignmentMode;
  return mode &&
    (resourceAssignmentModeValues as readonly string[]).includes(mode)
    ? mode
    : 'auto';
}

// ── The allocator ───────────────────────────────────────────────────────────

/**
 * Hold one resource per required category for `appointmentId`.
 *
 * | Case | Behaviour |
 * |---|---|
 * | no service requires anything | nothing happens (zero-cost path) |
 * | online, a category has nothing free | THROWS `CONFLICT` — caller must not create/keep the appointment |
 * | manual, a category has nothing free | allocates the least-conflicted resource with `allowOverlap`, returns a warning |
 * | `assignmentMode: 'manual'` + manual booking | no allocation at all — the front desk assigns later |
 * | `assignmentMode: 'manual'` + ONLINE booking | STILL auto-assigns (see below) |
 * | `explicitResourceIds` given | honoured, validated, `source: 'manual'` |
 * | capacity > 1 | `allowOverlap = true` — the exclusion constraint cannot count to N |
 *
 * The hold runs `[startDate, endDate + turnaroundMinutes)` — turnaround extends
 * the HOLD, never the appointment, which is why `appointment_resource` carries
 * its own dates. `turnaroundMinutes` is stored on the row so the calendar can
 * render the cleanup tail differently from the treatment.
 *
 * Expects to already be inside an org scope (`withOrgScope` /
 * `withPublicOrgScope`) — it issues raw queries on the connection it is given
 * and never opens its own, so it composes with a caller's transaction.
 */
export async function allocateAppointmentResources(
  db: DbConnection,
  input: AllocateAppointmentResourcesInput
): Promise<AllocateAppointmentResourcesResult> {
  const {
    organizationId,
    appointmentId,
    startDate,
    endDate,
    timeZone,
    locationId,
    isManual,
    explicitResourceIds,
    excludeAppointmentIds,
  } = input;

  const serviceIds = [...new Set(input.serviceIds.filter(Boolean))];

  // Explicit staff picks outrank the org's mode entirely: someone has already
  // decided, and second-guessing them would silently discard the decision.
  //
  // THIS RUNS BEFORE THE ZERO-COST GUARD, and it has to. The guard returns
  // early when no service in the cart carries a requirement row — which is
  // true of a booking where staff picked a room for a service that demands
  // none. Behind the guard, those ids were read by nothing and the booking
  // quietly held nothing at all: the exact silent drop the rest of this file
  // promises never happens.
  //
  // The zero-cost guarantee is untouched. An org that has never created a
  // resource cannot produce an explicit id — there is nothing to pick — so
  // this condition is false for every one of them and the guard below is
  // still the first thing they reach.
  if (explicitResourceIds && explicitResourceIds.length > 0) {
    return allocateExplicit(db, { ...input, serviceIds }, explicitResourceIds);
  }

  // ── ZERO-COST PATH — see the file header. ─────────────────────────────────
  //
  // The window is the WHOLE DAY, not the slot. `pickResourcesFor` breaks ties
  // between free rooms by how loaded each one already is that day — that is
  // the wear-levelling that stops every booking piling into whichever room
  // sorts first. It counts from `ctx.availabilityByResource[].busy`, so a
  // context loaded over the slot alone reports every room as load 0 and the
  // tie-break silently does nothing: a clinic booking chronologically filled
  // Room 1 to capacity while Room 2 sat empty all day.
  //
  // Widening cannot change WHETHER a room is free: every freeness check is an
  // overlap test against the slot, so the extra holds are simply outside it.
  // It costs one day-wide indexed read instead of one slot-wide one.
  const ctx = await loadResourceGateContext(db, {
    organizationId,
    serviceIds,
    from: startOfUtcDay(startDate),
    to: endOfUtcDay(
      new Date(endDate.getTime() + MAX_TURNAROUND_MINUTES * 60_000)
    ),
    timeZone,
    locationId,
    excludeAppointmentIds,
  });
  if (ctx === null) return EMPTY_RESULT;

  // `manual` mode means "the front desk assigns rooms itself" — for CONSOLE
  // bookings only.
  //
  // An ONLINE booking deliberately falls through to auto-assignment below. A
  // client cannot pick a room, so honouring manual mode there would leave every
  // online slot ungated — which is the exact hole this feature exists to close.
  // The setting controls who does the picking, never whether gating happens.
  const assignmentMode =
    input.assignmentMode ??
    (await resolveResourceAssignmentMode(db, organizationId));
  if (assignmentMode === 'manual' && isManual) return EMPTY_RESULT;

  const picks = pickResourcesFor(ctx, startDate, endDate);

  if (picks !== null) {
    const details = await describeResources(
      db,
      organizationId,
      picks.map((pick) => pick.resourceId)
    );
    await insertAllocations(db, input, organizationId, appointmentId, endDate, [
      ...picks.map((pick) => ({
        resourceId: pick.resourceId,
        turnaroundMinutes: pick.turnaroundMinutes,
        source: 'auto' as const,
        // capacity > 1 (a double treatment room, a 4-station nail bar) opts out
        // of `resource_no_overlap`: an exclusion constraint cannot count to N,
        // so the engine's in-memory capacity count is the enforcement point.
        allowOverlap: (details.get(pick.resourceId)?.capacity ?? 1) > 1,
      })),
    ]);
    return {
      allocated: picks.map((pick) => ({
        categoryId: pick.categoryId,
        resourceId: pick.resourceId,
      })),
      warnings: [],
    };
  }

  // ── At least one required category has nothing free. ──────────────────────
  const behaviour = input.unavailableBehaviour ?? (isManual ? 'warn' : 'block');
  const turnaroundMinutes = await resolveTurnaroundMinutes(
    db,
    organizationId,
    serviceIds
  );
  const diagnosis = await diagnoseCategories(db, {
    organizationId,
    serviceIds,
    locationId,
    startDate,
    holdEnd: new Date(endDate.getTime() + turnaroundMinutes * 60_000),
    excludeAppointmentIds,
  });

  if (behaviour === 'block') {
    const blocked = firstBlockedCategory(diagnosis);
    throw new ResourceAllocationError(
      ErrorCodes.CONFLICT,
      // Names the category the clinic itself named ("Rooms", "Lasers"), so the
      // customer-facing message reads in the clinic's own vocabulary.
      `No ${blocked?.categoryName ?? 'resource'} is available at this time`,
      { categoryId: blocked?.categoryId }
    );
  }

  // ── WARN-DON'T-BLOCK (manual / console) ──────────────────────────────────
  // Deliberately judged on real allocation conflicts alone, ignoring the
  // resource's posted working hours: a manual booking already bypasses the
  // practitioner's availability for exactly the same reason (staff book the
  // 19:00 favour for a regular). Only a genuine clash is worth a warning.
  return allocateLeastConflicted(
    db,
    input,
    diagnosis,
    turnaroundMinutes,
    endDate
  );
}

/**
 * Pre-write gate, mirroring the practitioner-overlap check it sits beside.
 *
 * Returns the `FeatureError` the caller should return, or null when the slot is
 * fine. Never writes anything, so a caller can run it BEFORE creating or moving
 * an appointment and refuse cleanly.
 *
 * Manual/console bookings are never blocked, so this is a no-op for them.
 */
export async function checkAppointmentResourcesAvailable(
  db: DbConnection,
  input: {
    organizationId: string;
    serviceIds: string[];
    startDate: Date;
    endDate: Date;
    timeZone: string;
    locationId?: string | null;
    isManual: boolean;
    excludeAppointmentIds?: string[];
  }
): Promise<FeatureError | null> {
  if (input.isManual) return null;

  const serviceIds = [...new Set(input.serviceIds.filter(Boolean))];

  // ── ZERO-COST PATH — see the file header. Must stay first. ────────────────
  const ctx = await loadResourceGateContext(db, {
    organizationId: input.organizationId,
    serviceIds,
    from: input.startDate,
    to: new Date(input.endDate.getTime() + MAX_TURNAROUND_MINUTES * 60_000),
    timeZone: input.timeZone,
    locationId: input.locationId,
    excludeAppointmentIds: input.excludeAppointmentIds,
  });
  if (ctx === null) return null;

  // `pickResourcesFor` is pure — running it as a dry run keeps the gate and the
  // allocator on ONE selection algorithm. Two implementations would drift, and
  // the drift would present as "the widget offered a slot the API then refused".
  if (pickResourcesFor(ctx, input.startDate, input.endDate) !== null) {
    return null;
  }

  const turnaroundMinutes = await resolveTurnaroundMinutes(
    db,
    input.organizationId,
    serviceIds
  );
  const blocked = firstBlockedCategory(
    await diagnoseCategories(db, {
      organizationId: input.organizationId,
      serviceIds,
      locationId: input.locationId,
      startDate: input.startDate,
      holdEnd: new Date(input.endDate.getTime() + turnaroundMinutes * 60_000),
      excludeAppointmentIds: input.excludeAppointmentIds,
    })
  );

  return new FeatureError(
    ErrorCodes.CONFLICT,
    `No ${blocked?.categoryName ?? 'resource'} is available at this time`
  );
}

/**
 * Move an appointment's holds onto its CURRENT times: release the old ones,
 * then take new ones. The shape every lifecycle path needs (update, reschedule,
 * restore-a-hold), so a call site only has to know the appointment id.
 *
 * Release happens HERE rather than at the call site so the ordering cannot be
 * got wrong: the old range must be gone before the new one is tested, or the
 * appointment conflicts with itself against `resource_no_overlap` (which
 * `excludeAppointmentIds` cannot help with — it filters the query, not the
 * constraint).
 *
 * A resource a human chose (`source: 'manual'`) is KEPT when it is still free
 * at the new time — moving a booking by ten minutes must not silently take the
 * front desk's room away from it. When it is no longer free the appointment
 * swaps to an auto pick and the caller gets a warning naming what was lost.
 *
 * Uses WARN semantics throughout (see `unavailableBehaviour`): by the time this
 * runs, the appointment has already moved. `checkAppointmentResourcesAvailable`
 * is the gate that refuses; this one records reality.
 */
export async function reallocateAppointmentResources(
  db: DbConnection,
  input: { appointmentId: string; organizationId: string }
): Promise<AllocateAppointmentResourcesResult> {
  const { appointmentId, organizationId } = input;

  const appt = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, appointmentId),
      eq(appointment.organizationId, organizationId),
      notDeleted(appointment)
    ),
    columns: {
      id: true,
      startDate: true,
      endDate: true,
      serviceId: true,
      source: true,
      // The appointment's OWN branch. Callers pass only an id, so without this
      // a re-allocation picks from the whole org and can hand a Dublin booking
      // a Cork room — see the note on the `allocateAppointmentResources` call
      // below.
      locationId: true,
    },
  });
  if (!appt) return EMPTY_RESULT;

  const serviceIds = await resolveAppointmentServiceIds(
    db,
    appt.id,
    appt.serviceId
  );

  // Read the human's choices BEFORE the release wipes them.
  const previousManualIds =
    serviceIds.length === 0
      ? []
      : (
          await db
            .select({ resourceId: appointmentResource.resourceId })
            .from(appointmentResource)
            .where(
              and(
                eq(appointmentResource.appointmentId, appt.id),
                eq(appointmentResource.organizationId, organizationId),
                eq(appointmentResource.source, 'manual')
              )
            )
        ).map((row) => row.resourceId);

  // Released unconditionally, even when there is nothing to re-hold: a booking
  // whose services were edited down to none must not keep holding a room.
  const released = await releaseAppointmentResources(db, {
    appointmentId: appt.id,
    organizationId,
  });
  if (!released.success) {
    logError(
      'appointments.reallocateAppointmentResources.release',
      new Error(released.error.message),
      {
        feature: 'appointments',
        extra: { appointmentId: appt.id, organizationId },
      }
    );
  }

  if (serviceIds.length === 0) return EMPTY_RESULT;

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { timezone: true },
  });

  // Which of the human's picks survive the move?
  const warnings: ResourceWarning[] = [];
  const keptManualIds: string[] = [];
  if (previousManualIds.length > 0) {
    const turnaroundMinutes = await resolveTurnaroundMinutes(
      db,
      organizationId,
      serviceIds
    );
    const details = await describeResources(
      db,
      organizationId,
      previousManualIds
    );
    const conflicts = await loadConflicts(db, {
      organizationId,
      resourceIds: previousManualIds,
      start: appt.startDate,
      end: new Date(appt.endDate.getTime() + turnaroundMinutes * 60_000),
      excludeAppointmentIds: [appt.id],
    });

    for (const resourceId of previousManualIds) {
      const detail = details.get(resourceId);
      const clashes = conflicts.get(resourceId) ?? [];

      // A human's pick is kept across a move only while it is still a room
      // this appointment could have. Two ways it stops being one:
      //
      //  1. it is now BUSY (below), or
      //  2. it is no longer at this appointment's BRANCH.
      //
      // The second is reachable through two ordinary actions, and neither
      // involves the appointment: the front desk manually picks Room 3 at
      // Dublin, someone later edits Room 3 and moves it to Cork
      // (`updateResource` takes `locationId`), and the next reschedule kept it
      // — a Dublin appointment holding a Cork room. The AUTO allocation below
      // has been branch-filtered since `cab7e9961`; this retention path ran
      // ahead of it and was not.
      //
      // A resource with no branch of its own is available everywhere and is
      // never dropped — `atLocationOrUnscoped`'s rule, applied in memory
      // because these rows are already loaded.
      const movedAway =
        !!appt.locationId &&
        !!detail &&
        detail.locationId !== null &&
        detail.locationId !== appt.locationId;

      if (detail && !movedAway && clashes.length < detail.capacity) {
        keptManualIds.push(resourceId);
        continue;
      }
      const clash = clashes[0];
      warnings.push({
        categoryId: detail?.categoryId ?? '',
        categoryName: detail?.categoryName ?? 'resource',
        resourceId,
        resourceName: detail?.name ?? null,
        conflictingAppointmentTitle: clash?.appointmentTitle ?? null,
        conflictStart: clash?.start ?? null,
        conflictEnd: clash?.end ?? null,
      });
    }
  }

  // `assignmentMode` is deliberately left unset — see the field's own comment:
  // resolving it here would read `org_defaults` on every update for every org,
  // including the ones with no rooms at all.
  const allocation = await allocateAppointmentResources(db, {
    organizationId,
    appointmentId: appt.id,
    serviceIds,
    startDate: appt.startDate,
    endDate: appt.endDate,
    timeZone: org?.timezone ?? 'UTC',
    isManual: appt.source === 'manual',
    // Scoped to the branch the appointment is AT, read from the row rather
    // than passed in: `reallocate` takes only an appointment id, so update,
    // reschedule and lead-hold-restore all reached here with no branch and
    // allocated from every branch's rooms. A null location on the resource
    // still matches — that means "available everywhere", not "nowhere".
    locationId: appt.locationId,
    explicitResourceIds: keptManualIds.length > 0 ? keptManualIds : undefined,
    excludeAppointmentIds: [appt.id],
    unavailableBehaviour: 'warn',
  });

  return {
    allocated: allocation.allocated,
    warnings: [...warnings, ...allocation.warnings],
  };
}

/**
 * Every service id this appointment consumes: the cart lines, falling back to
 * the denormalised primary `serviceId` for single-service bookings.
 *
 * An externally-synced calendar event has neither, so it resolves to `[]` and
 * never holds a room — a documented limitation, not an oversight: Google gives
 * us no service to look a requirement up by.
 */
export async function resolveAppointmentServiceIds(
  db: DbConnection,
  appointmentId: string,
  primaryServiceId?: string | null
): Promise<string[]> {
  const lines = await db
    .select({ serviceId: appointmentService.serviceId })
    .from(appointmentService)
    .where(eq(appointmentService.appointmentId, appointmentId));

  const ids = new Set<string>();
  for (const line of lines) if (line.serviceId) ids.add(line.serviceId);
  if (ids.size === 0 && primaryServiceId) ids.add(primaryServiceId);
  return [...ids];
}

// ── Internals ───────────────────────────────────────────────────────────────

interface PendingAllocation {
  resourceId: string;
  turnaroundMinutes: number;
  source: 'auto' | 'manual';
  allowOverlap: boolean;
}

/**
 * Write the holds.
 *
 * A `resource_no_overlap` violation here is NOT a bug and must never surface as
 * a 500: the application checks availability and then inserts, and two
 * concurrent online bookings can both observe the same free room. That race is
 * precisely why the constraint exists — it is the authority, and losing to it
 * means "someone just took it", i.e. a CONFLICT.
 */
async function insertAllocations(
  db: DbConnection,
  input: AllocateAppointmentResourcesInput,
  organizationId: string,
  appointmentId: string,
  endDate: Date,
  allocations: PendingAllocation[]
): Promise<void> {
  if (allocations.length === 0) return;

  try {
    await db.insert(appointmentResource).values(
      allocations.map((allocation) => ({
        organizationId,
        appointmentId,
        resourceId: allocation.resourceId,
        startDate: input.startDate,
        // Turnaround extends the HOLD, not the appointment.
        endDate: new Date(
          endDate.getTime() + allocation.turnaroundMinutes * 60_000
        ),
        turnaroundMinutes: allocation.turnaroundMinutes,
        source: allocation.source,
        allowOverlap: allocation.allowOverlap,
      }))
    );
  } catch (error) {
    // MUST go through `isExclusionViolation` (from @borradh-workspace/database),
    // never a message match: drizzle 0.45.2 re-throws every failed query as a
    // `DrizzleQueryError` whose message is the SQL text, and an INSERT's SQL
    // does not contain the constraint name. The real driver error — the one
    // carrying SQLSTATE 23P01 and `constraint_name` — is several links down
    // `.cause`. A message match here would silently never fire and this race
    // would surface as a 500 instead of "that room was just taken".
    //
    // A DEADLOCK (40P01) is the same race wearing a different SQLSTATE. Postgres
    // enforces the exclusion constraint by making each inserter wait on the
    // transaction holding a conflicting index entry, so two bookings grabbing
    // the same rooms wait on each other and one is killed outright rather than
    // being told 23P01 — the more so here, where a booking inserts several
    // holds and two carts can take the same rooms in opposite order. It carries
    // no constraint name, but this insert touches exactly one table and the
    // victim is rolled back in full, so a cycle can only mean another booking
    // took the room first.
    if (
      isExclusionViolation(error, 'resource_no_overlap') ||
      isDeadlock(error)
    ) {
      throw new ResourceAllocationError(
        ErrorCodes.CONFLICT,
        'That room was just taken — please pick another time'
      );
    }

    logError('appointments.allocateAppointmentResources', error, {
      feature: 'appointments',
      extra: {
        organizationId,
        appointmentId,
        resourceIds: allocations.map((allocation) => allocation.resourceId),
      },
    });
    throw new ResourceAllocationError(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to reserve the rooms for this appointment'
    );
  }
}

interface ResourceDetail {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string | null;
  capacity: number;
  /** NULL = belongs to no branch, i.e. available at every one. */
  locationId: string | null;
}

/** Name / category / capacity / branch for a set of resource ids, org-scoped. */
async function describeResources(
  db: DbConnection,
  organizationId: string,
  resourceIds: string[]
): Promise<Map<string, ResourceDetail>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: resource.id,
      name: resource.name,
      categoryId: resource.categoryId,
      categoryName: resourceCategory.name,
      capacity: resource.capacity,
      locationId: resource.locationId,
    })
    .from(resource)
    .leftJoin(resourceCategory, eq(resource.categoryId, resourceCategory.id))
    .where(
      and(
        eq(resource.organizationId, organizationId),
        inArray(resource.id, resourceIds)
      )
    );
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The cart's cleanup tail: the LARGEST turnaround across its services, because
 * v1 books ONE hold per category spanning the whole appointment. Clamped to the
 * documented 0–240 range so a bad row cannot hold a room for a week.
 */
async function resolveTurnaroundMinutes(
  db: DbConnection,
  organizationId: string,
  serviceIds: string[]
): Promise<number> {
  if (serviceIds.length === 0) return 0;
  const rows = await db
    .select({ turnaroundMinutes: organizationService.turnaroundMinutes })
    .from(organizationService)
    .where(
      and(
        eq(organizationService.organizationId, organizationId),
        inArray(organizationService.id, serviceIds)
      )
    );

  let max = 0;
  for (const row of rows) {
    const value = row.turnaroundMinutes ?? 0;
    if (value > max) max = value;
  }
  return Math.min(Math.max(max, 0), MAX_TURNAROUND_MINUTES);
}

interface CandidateDiagnosis {
  id: string;
  name: string;
  capacity: number;
  conflicts: Array<{
    appointmentTitle: string | null;
    start: Date;
    end: Date;
  }>;
}

interface CategoryDiagnosis {
  categoryId: string;
  categoryName: string;
  candidates: CandidateDiagnosis[];
}

/**
 * Explain WHY a slot could not be served, and give the manual path something to
 * override with.
 *
 * This runs ONLY when `pickResourcesFor` has already refused — it is a
 * diagnosis, never a second opinion. `resolveResourceAvailability` +
 * `pickResourcesFor` remain the single authority on whether a resource is free;
 * all this adds is the human-readable names and the conflicting appointment,
 * none of which the engine returns (and none of which it should — a slot-list
 * query has no business joining appointment titles).
 */
async function diagnoseCategories(
  db: DbConnection,
  input: {
    organizationId: string;
    serviceIds: string[];
    locationId?: string | null;
    startDate: Date;
    holdEnd: Date;
    excludeAppointmentIds?: string[];
  }
): Promise<CategoryDiagnosis[]> {
  const { organizationId, serviceIds, locationId, startDate, holdEnd } = input;
  if (serviceIds.length === 0) return [];

  const [requirementRows, eligibilityRows] = await Promise.all([
    db
      .select({
        serviceId: serviceResourceRequirement.serviceId,
        categoryId: serviceResourceRequirement.categoryId,
      })
      .from(serviceResourceRequirement)
      .where(
        and(
          eq(serviceResourceRequirement.organizationId, organizationId),
          inArray(serviceResourceRequirement.serviceId, serviceIds)
        )
      ),
    db
      .select({
        serviceId: serviceResourceEligibility.serviceId,
        resourceId: serviceResourceEligibility.resourceId,
      })
      .from(serviceResourceEligibility)
      .where(
        and(
          eq(serviceResourceEligibility.organizationId, organizationId),
          inArray(serviceResourceEligibility.serviceId, serviceIds)
        )
      ),
  ]);

  const requiredCategoryIds = [
    ...new Set(requirementRows.map((row) => row.categoryId)),
  ];
  if (requiredCategoryIds.length === 0) return [];

  // A requirement pointing at a soft-deleted or deactivated category degrades
  // to "no longer gated", never to "no longer sellable" — same rule the engine
  // applies.
  const categories = await db
    .select({ id: resourceCategory.id, name: resourceCategory.name })
    .from(resourceCategory)
    .where(
      and(
        eq(resourceCategory.organizationId, organizationId),
        inArray(resourceCategory.id, requiredCategoryIds),
        eq(resourceCategory.isActive, true),
        notDeleted(resourceCategory)
      )
    );
  if (categories.length === 0) return [];

  const resourceRows = await db
    .select({
      id: resource.id,
      name: resource.name,
      categoryId: resource.categoryId,
      capacity: resource.capacity,
      sortOrder: resource.sortOrder,
    })
    .from(resource)
    .where(
      and(
        eq(resource.organizationId, organizationId),
        inArray(
          resource.categoryId,
          categories.map((category) => category.id)
        ),
        eq(resource.isActive, true),
        notDeleted(resource),
        // A null-location resource (a trolley-mounted device) is available
        // everywhere, mirroring null-location shift rows.
        locationId
          ? atLocationOrUnscoped(resource.locationId, locationId)
          : undefined
      )
    );

  // ZERO eligibility rows for a category means EVERY resource in it qualifies.
  // Inverting this is the single most destructive mistake available here: it
  // would make every gated slot unbookable for every org that never restricted
  // a service to specific rooms — i.e. almost all of them.
  //
  // ACROSS SERVICES THE LISTS INTERSECT, they do not union. A cart holding two
  // services that both need a Room, one restricted to Room A and the other to
  // Room B, can be performed in NEITHER — there is no single room that does
  // both, and v1 holds one resource per category. Flattening every service's
  // rows into one set said "A or B", so the console booked one of them and
  // said nothing, while the online gate (which intersects, in
  // `categoryDemands`) correctly refused the slot. The two answers have to
  // agree; the gate's is the right one.
  const categoryOfResource = new Map(
    resourceRows.map((row) => [row.id, row.categoryId])
  );
  const eligibilityByService = new Map<string, Map<string, Set<string>>>();
  for (const row of eligibilityRows) {
    const categoryId = categoryOfResource.get(row.resourceId);
    if (!categoryId) continue;
    let byCategory = eligibilityByService.get(row.serviceId);
    if (!byCategory) {
      byCategory = new Map();
      eligibilityByService.set(row.serviceId, byCategory);
    }
    const set = byCategory.get(categoryId) ?? new Set<string>();
    set.add(row.resourceId);
    byCategory.set(categoryId, set);
  }

  // null = "not narrowed" (some service accepts anything in the category).
  // An EMPTY set is different and meaningful: the lists have nothing in
  // common, so the category is unsatisfiable.
  const narrowedByCategory = new Map<string, Set<string> | null>();
  for (const requirement of requirementRows) {
    const listed = eligibilityByService
      .get(requirement.serviceId)
      ?.get(requirement.categoryId);

    if (!listed || listed.size === 0) {
      if (!narrowedByCategory.has(requirement.categoryId)) {
        narrowedByCategory.set(requirement.categoryId, null);
      }
      continue;
    }

    const current = narrowedByCategory.get(requirement.categoryId) ?? null;
    narrowedByCategory.set(
      requirement.categoryId,
      current === null
        ? new Set(listed)
        : new Set([...current].filter((id) => listed.has(id)))
    );
  }

  const candidateRows = resourceRows
    .filter((row) => {
      const narrowed = narrowedByCategory.get(row.categoryId);
      return narrowed == null ? true : narrowed.has(row.id);
    })
    // Deterministic order. `id` is a UUID, so sorting by it shuffles rooms
    // arbitrarily between orgs; `sortOrder` then name is the order the clinic
    // itself chose, and it is what makes "which room did it pick" reproducible.
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const conflictsByResource = await loadConflicts(db, {
    organizationId,
    resourceIds: candidateRows.map((row) => row.id),
    start: startDate,
    end: holdEnd,
    excludeAppointmentIds: input.excludeAppointmentIds,
  });

  return categories.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    candidates: candidateRows
      .filter((row) => row.categoryId === category.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        capacity: row.capacity,
        conflicts: conflictsByResource.get(row.id) ?? [],
      })),
  }));
}

/** Allocations overlapping `[start, end)`, with the appointment they belong to. */
async function loadConflicts(
  db: DbConnection,
  input: {
    organizationId: string;
    resourceIds: string[];
    start: Date;
    end: Date;
    excludeAppointmentIds?: string[];
  }
): Promise<Map<string, CandidateDiagnosis['conflicts']>> {
  const byResource = new Map<string, CandidateDiagnosis['conflicts']>();
  if (input.resourceIds.length === 0) return byResource;

  const rows = await db
    .select({
      resourceId: appointmentResource.resourceId,
      start: appointmentResource.startDate,
      end: appointmentResource.endDate,
      appointmentTitle: appointment.title,
    })
    .from(appointmentResource)
    .leftJoin(
      appointment,
      eq(appointmentResource.appointmentId, appointment.id)
    )
    .where(
      and(
        eq(appointmentResource.organizationId, input.organizationId),
        inArray(appointmentResource.resourceId, input.resourceIds),
        // Half-open overlap, so back-to-back holds do not collide.
        lt(appointmentResource.startDate, input.end),
        gt(appointmentResource.endDate, input.start),
        input.excludeAppointmentIds && input.excludeAppointmentIds.length > 0
          ? notInArray(
              appointmentResource.appointmentId,
              input.excludeAppointmentIds
            )
          : undefined
      )
    );

  for (const row of rows) {
    const list = byResource.get(row.resourceId) ?? [];
    list.push({
      appointmentTitle: row.appointmentTitle ?? null,
      start: row.start,
      end: row.end,
    });
    byResource.set(row.resourceId, list);
  }
  return byResource;
}

/**
 * The category to name in the refusal. The first whose every candidate is at or
 * over capacity; failing that, simply the first required one — a category can
 * also be unsatisfiable for a reason this diagnosis does not model (a resource
 * outside its own working hours), and refusing without naming anything would be
 * worse than naming the likeliest culprit.
 */
function firstBlockedCategory(
  diagnosis: CategoryDiagnosis[]
): CategoryDiagnosis | undefined {
  return (
    diagnosis.find((category) =>
      category.candidates.every(
        (candidate) => candidate.conflicts.length >= candidate.capacity
      )
    ) ?? diagnosis[0]
  );
}

/**
 * Manual/console fallback: give the appointment the best room available even
 * when the best is already taken, and TELL the front desk which one clashes.
 *
 * Every override row carries `allowOverlap = true` so it opts out of
 * `resource_no_overlap` — the same opt-out `allow_double_booking` gives manual
 * appointments against `appointment_no_overlap`.
 */
async function allocateLeastConflicted(
  db: DbConnection,
  input: AllocateAppointmentResourcesInput,
  diagnosis: CategoryDiagnosis[],
  turnaroundMinutes: number,
  endDate: Date
): Promise<AllocateAppointmentResourcesResult> {
  const allocated: AllocatedResource[] = [];
  const warnings: ResourceWarning[] = [];
  const pending: PendingAllocation[] = [];

  for (const category of diagnosis) {
    if (category.candidates.length === 0) {
      // Nothing to allocate and nothing to name — but the front desk still has
      // to learn that this appointment has no room.
      warnings.push({
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        resourceId: null,
        resourceName: null,
        conflictingAppointmentTitle: null,
        conflictStart: null,
        conflictEnd: null,
      });
      continue;
    }

    // Candidates are already id-sorted, so ties resolve deterministically.
    const best = category.candidates.reduce((a, b) =>
      b.conflicts.length < a.conflicts.length ? b : a
    );
    const isFree = best.conflicts.length < best.capacity;

    allocated.push({
      categoryId: category.categoryId,
      resourceId: best.id,
    });
    pending.push({
      resourceId: best.id,
      turnaroundMinutes,
      source: 'auto',
      allowOverlap: !isFree || best.capacity > 1,
    });

    if (!isFree) {
      const clash = best.conflicts[0];
      warnings.push({
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        resourceId: best.id,
        resourceName: best.name,
        conflictingAppointmentTitle: clash?.appointmentTitle ?? null,
        conflictStart: clash?.start ?? null,
        conflictEnd: clash?.end ?? null,
      });
    }
  }

  await insertAllocations(
    db,
    input,
    input.organizationId,
    input.appointmentId,
    endDate,
    pending
  );

  return { allocated, warnings };
}

/**
 * Honour caller-supplied resource ids verbatim, after checking they are real.
 *
 * Rejected with `VALIDATION_ERROR` (never silently dropped — a dropped id means
 * the appointment quietly gets a different room than the one the operator
 * chose): another org's resource, an inactive or soft-deleted one, or two from
 * the same category (v1 holds exactly one resource per category).
 *
 * A pick from a category nothing in the cart REQUIRES is honoured, not
 * refused — see the note at the check. Requirements decide what is gated, not
 * what staff may record.
 *
 * `allowOverlap` is NOT set for capacity-1 resources: if the operator picked a
 * room that is genuinely busy, `resource_no_overlap` fires and surfaces as a
 * CONFLICT. Forcing a known clash is the reassign endpoint's job, behind its
 * own explicit `force` flag.
 */
async function allocateExplicit(
  db: DbConnection,
  input: AllocateAppointmentResourcesInput & { serviceIds: string[] },
  explicitResourceIds: string[]
): Promise<AllocateAppointmentResourcesResult> {
  const { organizationId, serviceIds } = input;
  const overbookAllowed = input.allowResourceOverbook === true;

  const requirementRows = await db
    .select({ categoryId: serviceResourceRequirement.categoryId })
    .from(serviceResourceRequirement)
    .where(
      and(
        eq(serviceResourceRequirement.organizationId, organizationId),
        inArray(serviceResourceRequirement.serviceId, serviceIds)
      )
    );
  const requiredCategoryIds = new Set(
    requirementRows.map((row) => row.categoryId)
  );

  const rows = await db
    .select({
      id: resource.id,
      name: resource.name,
      categoryId: resource.categoryId,
      capacity: resource.capacity,
    })
    .from(resource)
    .where(
      and(
        eq(resource.organizationId, organizationId),
        inArray(resource.id, explicitResourceIds),
        eq(resource.isActive, true),
        notDeleted(resource)
      )
    );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const seenCategories = new Set<string>();
  const allocated: AllocatedResource[] = [];
  const pending: PendingAllocation[] = [];
  const turnaroundMinutes = await resolveTurnaroundMinutes(
    db,
    organizationId,
    serviceIds
  );

  // CAPACITY, for the shared resources the exclusion constraint cannot police.
  //
  // `resource_no_overlap` is predicated on `allow_overlap = false`, and every
  // hold on a capacity > 1 resource is written `true` — a constraint cannot
  // count to N. That makes this in-memory count the ONLY enforcement, and
  // `allocateExplicit` never ran it: a two-station nail bar named explicitly
  // accepted a third, a fourth, a tenth booking, silently. The auto path has
  // always counted (see `isFree`); naming the resource should not be the way
  // round the rule.
  const holdEnd = new Date(
    input.endDate.getTime() + turnaroundMinutes * 60_000
  );
  const conflictsByResource = await loadConflicts(db, {
    organizationId,
    resourceIds: [...new Set(explicitResourceIds)],
    start: input.startDate,
    end: holdEnd,
    excludeAppointmentIds: input.excludeAppointmentIds,
  });

  for (const resourceId of [...new Set(explicitResourceIds)]) {
    const row = byId.get(resourceId);
    if (!row) {
      throw new ResourceAllocationError(
        ErrorCodes.VALIDATION_ERROR,
        `Resource "${resourceId}" is not an active resource in this organization`
      );
    }
    // A pick from a category NO service requires is allowed on purpose. The
    // front desk books a facial into a treatment room whether or not the
    // service definition says it must be, and refusing that made the booking
    // dialog's optional pickers unusable. What is still refused above is the
    // thing a stale or hostile client sends: another org's resource, an
    // inactive one, a deleted one.
    const isRequired = requiredCategoryIds.has(row.categoryId);
    if (seenCategories.has(row.categoryId)) {
      throw new ResourceAllocationError(
        ErrorCodes.VALIDATION_ERROR,
        `More than one resource was supplied for the same category ("${row.name}")`
      );
    }
    seenCategories.add(row.categoryId);

    // Over capacity is a CONFLICT, not a validation error: it is a fact about
    // this moment in the diary, not about the request. `allowResourceOverbook`
    // is the deliberate way past it — the operator was shown the clash and
    // said yes — which is exactly the same override the single-occupancy case
    // gets, so a shared room is not accidentally stricter than a private one.
    const taken = (conflictsByResource.get(row.id) ?? []).length;
    if (taken >= row.capacity && !(overbookAllowed && input.isManual)) {
      throw new ResourceAllocationError(
        ErrorCodes.CONFLICT,
        `${row.name} is already fully booked for that time`,
        { resourceId: row.id, resourceName: row.name }
      );
    }

    allocated.push({ categoryId: row.categoryId, resourceId: row.id });
    pending.push({
      resourceId: row.id,
      // Turnaround belongs to the REQUIREMENT. An optional room the operator
      // added carries none of the cart's cleanup time — holding a spare chair
      // 15 minutes past the appointment because the laser needs it would be
      // an invented booking constraint.
      turnaroundMinutes: isRequired ? turnaroundMinutes : 0,
      source: 'manual',
      // A shared resource is always outside the exclusion constraint (it
      // cannot count to N). A single-occupancy one only leaves it when a human
      // said so, on the console — see `allowResourceOverbook`.
      allowOverlap: row.capacity > 1 || (overbookAllowed && input.isManual),
    });
  }

  await insertAllocations(
    db,
    input,
    organizationId,
    input.appointmentId,
    input.endDate,
    pending
  );

  // A category the operator did NOT name still has to be filled. Leaving it
  // unallocated would be a silent gating hole: the engine would go on offering
  // that laser to everyone else while this appointment is actually using it.
  const uncovered = [...requiredCategoryIds].filter(
    (categoryId) => !seenCategories.has(categoryId)
  );
  if (uncovered.length === 0) return { allocated, warnings: [] };

  const diagnosis = (
    await diagnoseCategories(db, {
      organizationId,
      serviceIds,
      locationId: input.locationId,
      startDate: input.startDate,
      holdEnd: new Date(input.endDate.getTime() + turnaroundMinutes * 60_000),
      excludeAppointmentIds: input.excludeAppointmentIds,
    })
  ).filter((category) => uncovered.includes(category.categoryId));

  const filled = await allocateLeastConflicted(
    db,
    input,
    diagnosis,
    turnaroundMinutes,
    input.endDate
  );

  return {
    allocated: [...allocated, ...filled.allocated],
    warnings: filled.warnings,
  };
}
