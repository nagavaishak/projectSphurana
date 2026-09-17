/**
 * Phase 7 §7e (part 2) — WHICH room a booking gets: explicit choice vs automatic.
 *
 * The console's booking dialog is being reworked so the front desk picks a
 * resource PER REQUIRED CATEGORY, each defaulting to "Unassigned", and can also
 * attach a room to a service that requires none. Every one of those UI states
 * bottoms out in one field — `createAppointment({ resourceIds })` — and the
 * server's response to each has to be a decision, not an accident. This spec is
 * where that decision is written down.
 *
 * `resource-assignment-modes.int-spec.ts` already locks the auto-vs-manual axis
 * and the four "bad id" refusals it can reach (another org, a non-required
 * category, a deactivated resource, two from one category). This file does NOT
 * restate those. It extends into the states the new dialog can actually produce
 * and the older spec never reaches: an EMPTY array, a PARTIAL selection across
 * three categories, a SOFT-DELETED or entirely unknown id, a capacity-2 pick, a
 * named room that is busy on the ONLINE path, and a service with no
 * requirements at all.
 *
 * Behaviour locked here:
 *  - Named ids are honoured verbatim in EVERY required category, each stored as
 *    `source = 'manual'`, even when the auto-picker would have chosen otherwise.
 *  - `resourceIds: []` IS NOT "unassigned". An empty array is indistinguishable
 *    from omitting the field, so under `auto` mode it AUTO-ASSIGNS. The only
 *    thing that produces a genuinely unassigned booking is `manual` mode on the
 *    console path. A dialog that defaults every picker to "Unassigned" and posts
 *    `[]` on an `auto` org will silently get rooms assigned anyway.
 *  - A PARTIAL selection is completed, never truncated: the categories the
 *    operator skipped are auto-filled, and the slot is genuinely gated
 *    afterwards — an unheld requirement is a silent gating hole.
 *  - ⚠️  AN EXPLICIT ID FOR A CATEGORY THE SERVICE DOES NOT REQUIRE IS NOT
 *    HANDLED CONSISTENTLY, and both halves are pinned below:
 *      · service requires SOMETHING ELSE ⇒ `VALIDATION_ERROR`, no appointment.
 *      · service requires NOTHING AT ALL ⇒ the id is SILENTLY DROPPED. The
 *        booking succeeds holding nothing, with no error and no warning.
 *    The second is the exact case the new dialog is about to enable ("attach a
 *    room to a service that needs none"), and today it cannot work: the
 *    zero-cost rollout guard returns before `resourceIds` is ever looked at.
 *    See the test's own comment for the mechanism and the fix location.
 *  - ⚠️  NAMING A ROOM MAKES A CONSOLE BOOKING STRICTER, NOT LOOSER. The
 *    warn-don't-block rule the console relies on applies to the AUTO path only:
 *    an auto pick that lands on a busy room is accepted with a warning and
 *    `allow_overlap = true`, while the SAME room named explicitly is refused
 *    with `CONFLICT`. Both are pinned together in one world so the asymmetry
 *    cannot be changed on one side by accident.
 *  - A busy room named on an ONLINE booking is a hard `CONFLICT` and the
 *    appointment row is rolled back.
 *  - An id that is soft-deleted, or that does not exist at all, is
 *    `VALIDATION_ERROR` — never silently swapped for a live room.
 *  - THE ROLLOUT-SAFETY PATH, asserted by MECHANISM: a service with no
 *    requirement rows costs exactly ONE query against any resource table (the
 *    requirement lookup that finds nothing) and holds nothing. The queries are
 *    counted off drizzle's own logger, and the count of ALL queries is asserted
 *    non-zero first, so the test cannot pass by failing to observe anything.
 */
import {
  appointment,
  appointmentResource,
  db,
  orgDefaults,
} from '@borradh-workspace/database';
import { createAppointment } from '@borradh-workspace/features/appointments';
import {
  hasFreeResourcesFor,
  loadResourceGateContext,
} from '@borradh-workspace/features/scheduling';
import { and, eq } from 'drizzle-orm';
import { seedLead, seedOrganization, seedUser } from './harness.js';
import {
  allocationsFor,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

/** See appointment-double-booking.int-spec.ts for why the fixture is rebased. */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 6, 1); // earliest literal: 2026-07-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

const HOUR = {
  nine: {
    startDate: at('2026-07-01T09:00:00.000Z'),
    endDate: at('2026-07-01T10:00:00.000Z'),
  },
  eleven: {
    startDate: at('2026-07-01T11:00:00.000Z'),
    endDate: at('2026-07-01T12:00:00.000Z'),
  },
  fourteen: {
    startDate: at('2026-07-01T14:00:00.000Z'),
    endDate: at('2026-07-01T15:00:00.000Z'),
  },
  sixteen: {
    startDate: at('2026-07-01T16:00:00.000Z'),
    endDate: at('2026-07-01T17:00:00.000Z'),
  },
};

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

interface SeededCategory {
  name: string;
  categoryId: string;
  /** Resource ids in `sortOrder` order — index 0 is what the auto-picker takes. */
  resourceIds: string[];
}

interface World {
  organizationId: string;
  assigneeId: string;
  /** A second assignee, so two same-time bookings do not clash on the ASSIGNEE. */
  otherAssigneeId: string;
  leadId: string;
  serviceId: string;
  categories: SeededCategory[];
  category: (name: string) => SeededCategory;
}

interface CategorySpec {
  name: string;
  kind?: 'room' | 'equipment';
  resources?: number;
  capacity?: number;
  /** false ⇒ the category and its rooms exist, but the service does NOT require it. */
  required?: boolean;
}

async function seedWorld(
  input: {
    categories?: CategorySpec[];
    assignmentMode?: 'auto' | 'manual';
  } = {}
): Promise<World> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const otherAssignee = await seedUser();
  const leadId = await seedLead({ organizationId });
  const serviceId = await seedResourceService({
    organizationId,
    appointmentDuration: 60,
  });

  const specs = input.categories ?? [{ name: 'Rooms', resources: 1 }];
  const categories: SeededCategory[] = [];

  for (const spec of specs) {
    const categoryId = await seedResourceCategory({
      organizationId,
      name: spec.name,
      kind: spec.kind ?? 'room',
    });
    const resourceIds: string[] = [];
    for (let index = 0; index < (spec.resources ?? 1); index += 1) {
      resourceIds.push(
        await seedResource({
          organizationId,
          categoryId,
          name: `${spec.name} ${index + 1}`,
          sortOrder: index,
          capacity: spec.capacity ?? 1,
        })
      );
    }
    if (spec.required !== false) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }
    categories.push({ name: spec.name, categoryId, resourceIds });
  }

  if (input.assignmentMode) {
    await db
      .insert(orgDefaults)
      .values({ organizationId, resourceAssignmentMode: input.assignmentMode });
  }

  return {
    organizationId,
    assigneeId: assignee.id,
    otherAssigneeId: otherAssignee.id,
    leadId,
    serviceId,
    categories,
    category: (name) => {
      const found = categories.find((entry) => entry.name === name);
      if (!found) throw new Error(`No seeded category named "${name}"`);
      return found;
    },
  };
}

interface BookInput {
  title: string;
  startDate: Date;
  endDate: Date;
  /** Omitted ⇒ the console path (`manual`). */
  source?: 'booking_form';
  resourceIds?: string[];
  useOtherAssignee?: boolean;
  serviceId?: string;
  /** The operator was shown the clash and chose to book anyway. */
  allowResourceOverbook?: boolean;
}

const book = (world: World, input: BookInput) =>
  createAppointment(db, {
    title: input.title,
    startDate: input.startDate,
    endDate: input.endDate,
    leadId: world.leadId,
    assignedToId: input.useOtherAssignee
      ? world.otherAssigneeId
      : world.assigneeId,
    organizationId: world.organizationId,
    serviceId: input.serviceId ?? world.serviceId,
    resourceIds: input.resourceIds,
    allowResourceOverbook: input.allowResourceOverbook,
    source: input.source,
  });

/** Did a refusal actually roll the appointment row back? */
async function appointmentExists(
  organizationId: string,
  title: string
): Promise<boolean> {
  const rows = await db
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.organizationId, organizationId),
        eq(appointment.title, title)
      )
    );
  return rows.length > 0;
}

/** Every allocation row in the org, whichever appointment it belongs to. */
async function orgAllocationCount(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: appointmentResource.id })
    .from(appointmentResource)
    .where(eq(appointmentResource.organizationId, organizationId));
  return rows.length;
}

/**
 * Would the booking ENGINE still offer this slot for the world's service?
 *
 * Asked through `loadResourceGateContext` + `hasFreeResourcesFor` — the exact
 * pair behind every public slot list — so "the requirement is gated" is proved
 * against the thing customers actually hit, not against a row count.
 */
async function slotIsOfferable(
  world: World,
  start: Date,
  end: Date
): Promise<boolean> {
  const ctx = await loadResourceGateContext(db, {
    organizationId: world.organizationId,
    serviceIds: [world.serviceId],
    from: start,
    to: new Date(end.getTime() + 240 * 60_000),
    timeZone: 'UTC',
  });
  if (ctx === null) return true; // nothing is required ⇒ nothing gates it
  return hasFreeResourcesFor(ctx, start, end);
}

/**
 * Record the SQL of every query drizzle runs during `operation`.
 *
 * Swaps drizzle's own query logger (a `NoopLogger` by default) for a collector.
 * Callers MUST assert the total is non-zero before asserting a filtered count
 * is zero — otherwise a future drizzle version that stops consulting
 * `session.logger` would turn "the zero-cost path is real" into "we observed
 * nothing", and the test would pass for the opposite reason.
 */
async function withQueryLog<T>(
  operation: () => Promise<T>
): Promise<{ result: T; queries: string[] }> {
  const session = (
    db as unknown as {
      session: {
        logger: { logQuery: (query: string, params: unknown[]) => void };
      };
    }
  ).session;
  const original = session.logger;
  const queries: string[] = [];
  session.logger = {
    logQuery: (query: string) => {
      queries.push(query);
    },
  };
  try {
    const result = await operation();
    return { result, queries };
  } finally {
    session.logger = original;
  }
}

/* ------------------------------------------------------------------ */

describe('Phase 7 §7e (part 2) — explicit vs automatic resource choice', () => {
  it('explicit ids are honoured verbatim in EVERY required category, each as source = manual', async () => {
    const world = await seedWorld({
      categories: [
        { name: 'Rooms', resources: 2 },
        { name: 'Lasers', kind: 'equipment', resources: 2 },
      ],
    });
    const rooms = world.category('Rooms');
    const lasers = world.category('Lasers');
    // The SECOND of each — the auto-picker takes index 0, so a silent re-pick
    // anywhere in the chain is visible rather than coincidentally identical.
    const chosenRoom = rooms.resourceIds[1];
    const chosenLaser = lasers.resourceIds[1];

    const created = await book(world, {
      title: 'Operator picked both',
      ...HOUR.fourteen,
      resourceIds: [chosenRoom, chosenLaser],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(2);
    const byResource = new Map(holds.map((hold) => [hold.resourceId, hold]));
    expect(byResource.get(chosenRoom)?.source).toBe('manual');
    expect(byResource.get(chosenLaser)?.source).toBe('manual');
    // Neither auto-pick default was taken.
    expect(byResource.has(rooms.resourceIds[0])).toBe(false);
    expect(byResource.has(lasers.resourceIds[0])).toBe(false);

    expect(
      created.data.resources
        .map((entry) => entry.resourceId)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual([chosenRoom, chosenLaser].sort((a, b) => a.localeCompare(b)));
  });

  it('an OMITTED resourceIds and an EMPTY resourceIds array behave identically — [] is not "unassigned"', async () => {
    // The new dialog defaults every picker to "Unassigned". If that posts `[]`,
    // an `auto` org still gets a room assigned: the allocator's explicit branch
    // is guarded by `length > 0`, so an empty array falls through to the exact
    // same auto-assignment as omitting the field. A dialog that means
    // "unassigned" must therefore switch the ORG'S MODE, not send an empty list.
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 2 }],
    });
    const rooms = world.category('Rooms');

    const omitted = await book(world, { title: 'Omitted', ...HOUR.nine });
    if (!omitted.success) throw new Error(omitted.error.message);
    const omittedHolds = await allocationsFor(omitted.data.id);
    expect(omittedHolds).toHaveLength(1);
    expect(omittedHolds[0].source).toBe('auto');
    expect(omittedHolds[0].resourceId).toBe(rooms.resourceIds[0]);

    const empty = await book(world, {
      title: 'Empty array',
      ...HOUR.fourteen,
      resourceIds: [],
    });
    if (!empty.success) throw new Error(empty.error.message);
    const emptyHolds = await allocationsFor(empty.data.id);
    // NOT zero. An empty array is a request for auto-assignment.
    expect(emptyHolds).toHaveLength(1);
    expect(emptyHolds[0].source).toBe('auto');
    expect(empty.data.resources).toHaveLength(1);
  });

  it('naming SOME categories fills the rest automatically, and leaves nothing ungated', async () => {
    const world = await seedWorld({
      categories: [
        { name: 'Rooms', resources: 2 },
        { name: 'Lasers', kind: 'equipment', resources: 1 },
        { name: 'Chairs', resources: 1 },
      ],
    });
    const rooms = world.category('Rooms');
    const lasers = world.category('Lasers');
    const chairs = world.category('Chairs');

    const created = await book(world, {
      title: 'Named the room only',
      ...HOUR.fourteen,
      resourceIds: [rooms.resourceIds[1]],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(3);
    const byResource = new Map(holds.map((hold) => [hold.resourceId, hold]));
    expect(byResource.get(rooms.resourceIds[1])?.source).toBe('manual');
    expect(byResource.get(lasers.resourceIds[0])?.source).toBe('auto');
    expect(byResource.get(chairs.resourceIds[0])?.source).toBe('auto');

    // The point of filling them: the engine must no longer offer this slot,
    // because the single laser and the single chair are now spoken for. A
    // requirement left unheld would read as free here — the silent gating hole.
    expect(
      await slotIsOfferable(
        world,
        HOUR.fourteen.startDate,
        HOUR.fourteen.endDate
      )
    ).toBe(false);
  });

  /**
   * ⚠️  CHARACTERISATION TEST — LOCKS AN INCONSISTENCY, NOT AN INTENDED RULE.
   *
   * `allocateAppointmentResources` opens with the rollout-safety guard:
   *
   *     const ctx = await loadResourceGateContext(…);
   *     if (ctx === null) return EMPTY_RESULT;          // ← returns here
   *     if (explicitResourceIds?.length) return allocateExplicit(…);
   *
   * and `loadResourceGateContext` returns null whenever NO service in the cart
   * has a requirement row. So for a requirement-free service the explicit ids
   * are never read at all: no validation, no allocation, no warning, no error.
   *
   * That contradicts the rule the same file states two branches later — an
   * unusable explicit id is "never silently dropped: a dropped id means the
   * booking quietly gets a different room than the operator chose" — and it is
   * exactly the case the reworked dialog is about to enable ("attach a room to
   * a service that needs none"). Today that UI would report success and hold
   * nothing, and the room would go on being offered to everyone else.
   *
   * Pinned rather than fixed, because the fix is a product decision with two
   * defensible answers (honour it as an ad-hoc hold, or refuse it) and it lives
   * in `allocate-appointment-resources.ts` — either move the explicit branch
   * ABOVE the `ctx === null` return, or validate `explicitResourceIds` before
   * the guard. WHEN THAT LANDS THIS TEST WILL FAIL; that is the point.
   */
  it('an explicit id for a non-required category is honoured, gated service or not', async () => {
    const world = await seedWorld({
      categories: [
        { name: 'Rooms', resources: 1 },
        // Exists, is active, is in this org — and nothing requires it.
        { name: 'Storage cupboards', resources: 1, required: false },
      ],
    });
    const cupboard = world.category('Storage cupboards').resourceIds[0];

    // (a) The service requires SOMETHING (Rooms). The stray id is held AND the
    // requirement is still filled — honouring the pick must never leave the
    // requirement unfilled, which would be a silent gating hole.
    const gated = await book(world, {
      title: 'Cupboard on a gated service',
      ...HOUR.nine,
      resourceIds: [cupboard],
    });
    expect(gated.success).toBe(true);
    if (!gated.success) throw new Error(gated.error.message);

    const gatedHolds = (await allocationsFor(gated.data.id)).map(
      (row) => row.resourceId
    );
    expect(gatedHolds).toHaveLength(2);
    expect(gatedHolds).toContain(cupboard);

    // (b) The service requires NOTHING. This is the case that used to be
    // silently DROPPED: the zero-cost rollout guard returned before
    // `explicitResourceIds` was ever read, so the booking reported success
    // holding nothing at all. It is the ordinary front-desk case — a
    // consultation that is still going to occupy a room.
    const ungatedServiceId = await seedResourceService({
      organizationId: world.organizationId,
      name: 'Consultation (no room needed)',
      appointmentDuration: 60,
    });

    const ungated = await book(world, {
      title: 'Cupboard on an ungated service',
      ...HOUR.eleven,
      serviceId: ungatedServiceId,
      resourceIds: [cupboard],
    });
    expect(ungated.success).toBe(true);
    if (!ungated.success) throw new Error(ungated.error.message);

    const ungatedHolds = await allocationsFor(ungated.data.id);
    expect(ungatedHolds.map((row) => row.resourceId)).toEqual([cupboard]);
    // No requirement ⇒ no cleanup tail. Turnaround belongs to the requirement.
    expect(ungatedHolds[0].turnaroundMinutes).toBe(0);
  });

  it('an explicitly-named room that is busy on an ONLINE booking ⇒ CONFLICT, and the appointment is rolled back', async () => {
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 2 }],
    });
    const rooms = world.category('Rooms');

    const holder = await book(world, {
      title: 'Holds Room 1',
      ...HOUR.fourteen,
      resourceIds: [rooms.resourceIds[0]],
    });
    expect(holder.success).toBe(true);

    // `allocateExplicit` never sets `allowOverlap` for a capacity-1 resource, so
    // the INSERT loses to `resource_no_overlap` — and that MUST read as "someone
    // just took it", not as an INTERNAL_ERROR.
    const online = await book(world, {
      title: 'Online insists on Room 1',
      ...HOUR.fourteen,
      source: 'booking_form',
      useOtherAssignee: true,
      resourceIds: [rooms.resourceIds[0]],
    });
    expect(online.success).toBe(false);
    if (online.success) throw new Error('expected the clash to be refused');
    expect(online.error.code).toBe('CONFLICT');
    // The in-memory capacity count now fires BEFORE the INSERT, so the
    // message names the room instead of describing a lost race. Both are
    // CONFLICT; this one is the one a person can act on.
    expect(online.error.message).toContain('fully booked');

    expect(
      await appointmentExists(world.organizationId, 'Online insists on Room 1')
    ).toBe(false);
    // The free Room 2 was NOT silently substituted, and nothing extra was held.
    expect(await orgAllocationCount(world.organizationId)).toBe(1);
  });

  /**
   * The warn-don't-block rule the console depends on belongs to the AUTO path
   * ONLY. Naming a room makes the booking STRICTER, because `allocateExplicit`
   * deliberately withholds `allowOverlap` from a capacity-1 pick — forcing a
   * known clash is the reassign endpoint's job, behind its own `force` flag.
   *
   * Both halves run against the same busy room in the same world so the
   * asymmetry is locked as a pair: change one side and this fails.
   */
  it('LOCKED: from the console, a busy room NAMED is refused while the same busy room reached AUTOMATICALLY is booked with a warning', async () => {
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 1 }],
    });
    const onlyRoom = world.category('Rooms').resourceIds[0];

    const holder = await book(world, {
      title: 'Existing booking',
      ...HOUR.fourteen,
      resourceIds: [onlyRoom],
    });
    expect(holder.success).toBe(true);

    // (a) NAMED ⇒ refused outright, even though this is the console.
    const named = await book(world, {
      title: 'Front desk named the busy room',
      ...HOUR.fourteen,
      useOtherAssignee: true,
      resourceIds: [onlyRoom],
    });
    expect(named.success).toBe(false);
    if (named.success)
      throw new Error('expected the named clash to be refused');
    expect(named.error.code).toBe('CONFLICT');
    expect(
      await appointmentExists(
        world.organizationId,
        'Front desk named the busy room'
      )
    ).toBe(false);

    // (b) NOT named ⇒ the identical room, identically busy, is taken anyway,
    // with a warning naming what it steps on and an exclusion-constraint opt-out.
    const auto = await book(world, {
      title: 'Front desk let it auto-assign',
      ...HOUR.fourteen,
      useOtherAssignee: true,
    });
    expect(auto.success).toBe(true);
    if (!auto.success) throw new Error(auto.error.message);

    expect(auto.data.resourceWarnings).toHaveLength(1);
    expect(auto.data.resourceWarnings[0].resourceId).toBe(onlyRoom);
    expect(auto.data.resourceWarnings[0].conflictingAppointmentTitle).toBe(
      'Existing booking'
    );
    const holds = await allocationsFor(auto.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(onlyRoom);
    expect(holds[0].source).toBe('auto');
    expect(holds[0].allowOverlap).toBe(true);
  });

  it('an explicit pick fills a capacity-2 resource and then refuses the third', async () => {
    // Capacity > 1 (a double treatment room) cannot be policed by an exclusion
    // constraint — one cannot count to N — so every hold on a shared resource
    // is written `allow_overlap: true` and the in-memory count becomes the ONLY
    // enforcement point. `allocateExplicit` used not to run that count, so a
    // third booking of a two-station room landed silently.
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 1, capacity: 2 }],
    });
    const shared = world.category('Rooms').resourceIds[0];

    for (const title of ['Station one', 'Station two']) {
      const created = await book(world, {
        title,
        ...HOUR.fourteen,
        useOtherAssignee: title !== 'Station one',
        resourceIds: [shared],
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error.message);

      const holds = await allocationsFor(created.data.id);
      expect(holds).toHaveLength(1);
      expect(holds[0].resourceId).toBe(shared);
      expect(holds[0].source).toBe('manual');
      expect(holds[0].allowOverlap).toBe(true);
    }

    const third = await book(world, {
      title: 'One too many',
      ...HOUR.fourteen,
      useOtherAssignee: true,
      resourceIds: [shared],
    });
    expect(third.success).toBe(false);
    if (third.success) throw new Error('expected the third to be refused');
    expect(third.error.code).toBe('CONFLICT');

    // Refused AND rolled back — the appointment must not survive without its
    // room, which would be a booking nothing can be performed in.
    expect(await appointmentExists(world.organizationId, 'One too many')).toBe(
      false
    );
    expect(await orgAllocationCount(world.organizationId)).toBe(2);
  });

  // ...unless a human said so. The same override the single-occupancy case
  // gets, so a shared room is not accidentally STRICTER than a private one.
  it('lets a confirmed overbook past the capacity limit', async () => {
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 1, capacity: 2 }],
    });
    const shared = world.category('Rooms').resourceIds[0];

    for (const title of ['Station one', 'Station two']) {
      const created = await book(world, {
        title,
        ...HOUR.fourteen,
        useOtherAssignee: title !== 'Station one',
        resourceIds: [shared],
      });
      expect(created.success).toBe(true);
    }

    const third = await book(world, {
      title: 'Squeezed in',
      ...HOUR.fourteen,
      useOtherAssignee: true,
      resourceIds: [shared],
      allowResourceOverbook: true,
    });
    expect(third.success).toBe(true);
    if (!third.success) throw new Error(third.error.message);
    expect(await orgAllocationCount(world.organizationId)).toBe(3);
  });

  it('an explicit id naming a SOFT-DELETED resource ⇒ VALIDATION_ERROR, never a silent substitution', async () => {
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 1 }],
    });
    const rooms = world.category('Rooms');
    const removed = await seedResource({
      organizationId: world.organizationId,
      categoryId: rooms.categoryId,
      name: 'Room removed last week',
      sortOrder: 9,
      deletedAt: new Date(),
    });

    const created = await book(world, {
      title: 'Soft-deleted room',
      ...HOUR.fourteen,
      resourceIds: [removed],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(created.error.message).toContain(removed);

    expect(
      await appointmentExists(world.organizationId, 'Soft-deleted room')
    ).toBe(false);
    // The live room was NOT quietly used instead.
    expect(await orgAllocationCount(world.organizationId)).toBe(0);
  });

  it('an explicit id that does not exist at all ⇒ VALIDATION_ERROR, no appointment', async () => {
    // A stale id from a picker rendered before someone deleted the room.
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 1 }],
    });

    const created = await book(world, {
      title: 'Ghost room',
      ...HOUR.fourteen,
      resourceIds: ['res_does_not_exist'],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(await appointmentExists(world.organizationId, 'Ghost room')).toBe(
      false
    );
    expect(await orgAllocationCount(world.organizationId)).toBe(0);
  });

  it('manual mode + console + no explicit ids: ZERO allocations, and the room stays genuinely offerable', async () => {
    // The "Unassigned" default of the new dialog. The distinction that matters
    // downstream is that an unassigned booking holds NOTHING — so the room is
    // still sellable to a customer, and the front desk is the one carrying the
    // risk. Asserting the row count alone would not show that.
    const world = await seedWorld({
      categories: [{ name: 'Rooms', resources: 1 }],
      assignmentMode: 'manual',
    });

    const unassigned = await book(world, {
      title: 'Assign a room later',
      ...HOUR.fourteen,
    });
    expect(unassigned.success).toBe(true);
    if (!unassigned.success) throw new Error(unassigned.error.message);
    expect(unassigned.data.resources).toEqual([]);
    expect(unassigned.data.resourceWarnings).toEqual([]);
    expect(await allocationsFor(unassigned.data.id)).toEqual([]);

    // An empty array takes the same path under manual mode.
    const emptyArray = await book(world, {
      title: 'Also unassigned',
      ...HOUR.sixteen,
      resourceIds: [],
    });
    if (!emptyArray.success) throw new Error(emptyArray.error.message);
    expect(await allocationsFor(emptyArray.data.id)).toEqual([]);

    // Nothing is held, so the engine still offers the slot…
    expect(
      await slotIsOfferable(
        world,
        HOUR.fourteen.startDate,
        HOUR.fourteen.endDate
      )
    ).toBe(true);
    // …and an online customer can genuinely take the only room for it.
    const online = await book(world, {
      title: 'Customer takes the room',
      ...HOUR.fourteen,
      source: 'booking_form',
      useOtherAssignee: true,
    });
    expect(online.success).toBe(true);
    if (!online.success) throw new Error(online.error.message);
    expect(await allocationsFor(online.data.id)).toHaveLength(1);
  });

  it('manual mode + ONLINE: every required category is still auto-filled, and gating still bites', async () => {
    // A client cannot pick a room, so `manual` mode must not reach the online
    // path — otherwise every online slot on such an org would be ungated, which
    // is the exact hole this feature exists to close.
    const world = await seedWorld({
      categories: [
        { name: 'Rooms', resources: 1 },
        { name: 'Lasers', kind: 'equipment', resources: 1 },
      ],
      assignmentMode: 'manual',
    });

    const first = await book(world, {
      title: 'Online under manual mode',
      ...HOUR.fourteen,
      source: 'booking_form',
    });
    expect(first.success).toBe(true);
    if (!first.success) throw new Error(first.error.message);

    const holds = await allocationsFor(first.data.id);
    expect(holds).toHaveLength(2);
    expect(holds.every((hold) => hold.source === 'auto')).toBe(true);
    expect(
      first.data.resources.map((entry) => entry.categoryId).sort()
    ).toEqual(
      [
        world.category('Rooms').categoryId,
        world.category('Lasers').categoryId,
      ].sort()
    );

    // Both categories are now exhausted, so the next online booking is refused
    // — `manual` mode governs WHO picks, never WHETHER gating happens.
    const second = await book(world, {
      title: 'Second online must be refused',
      ...HOUR.fourteen,
      source: 'booking_form',
      useOtherAssignee: true,
    });
    expect(second.success).toBe(false);
    if (second.success) throw new Error('expected the online booking to block');
    expect(second.error.code).toBe('CONFLICT');
    expect(second.error.message).toMatch(/Rooms|Lasers/);
    expect(
      await appointmentExists(
        world.organizationId,
        'Second online must be refused'
      )
    ).toBe(false);
  });

  it('a service with NO requirements costs exactly ONE query against any resource table, and holds nothing', async () => {
    // THE ROLLOUT-SAFETY GUARANTEE, asserted by mechanism rather than by
    // outcome. The org here is fully kitted out — categories, rooms, a laser,
    // an `org_defaults` row — and the booked service simply requires none of
    // it. The documented promise is "exactly one indexed lookup that finds
    // nothing", i.e. the `service_resource_requirement` select and NOTHING
    // else: no `resource` read, no `resource_category` read, no
    // `appointment_resource` write, and — the easy one to regress — no
    // `org_defaults` read for the assignment mode.
    const world = await seedWorld({
      categories: [
        { name: 'Rooms', resources: 2, required: false },
        { name: 'Lasers', kind: 'equipment', resources: 1, required: false },
      ],
      assignmentMode: 'manual',
    });

    const { result: created, queries } = await withQueryLog(() =>
      book(world, { title: 'Ungated booking', ...HOUR.fourteen })
    );

    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    expect(created.data.resources).toEqual([]);
    expect(created.data.resourceWarnings).toEqual([]);
    expect(await orgAllocationCount(world.organizationId)).toBe(0);

    // Guard the instrumentation itself FIRST: if the logger were never called,
    // every filtered count below would be zero and this test would pass for the
    // exact opposite reason.
    expect(queries.length).toBeGreaterThan(0);

    const touchingResources = queries.filter((query) =>
      /resource|org_defaults/i.test(query)
    );
    expect(touchingResources).toHaveLength(1);
    expect(touchingResources[0]).toContain('service_resource_requirement');
  });
});
