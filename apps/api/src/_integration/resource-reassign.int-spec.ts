/**
 * Phase 7 §7f — reassigning a held resource (drag-to-reassign / override).
 *
 * `reassignAppointmentResource` is the write behind dragging a booking sideways
 * on the rooms calendar and behind the "move to another room" popover. It is
 * the one resource write a HUMAN performs deliberately, which makes it the one
 * place where "helpfully" adjusting something else is most damaging: the front
 * desk is looking at a room grid, not at a client's confirmation email.
 *
 * Driven against the real DB so the `resource_no_overlap` exclusion constraint,
 * the FKs and the org scoping are all genuinely in play. Allocations are seeded
 * DIRECTLY (rather than produced by `createAppointment`) so each test states
 * exactly what is held before the move — this file is about the move, not about
 * the auto-picker that `resource-assignment-modes.int-spec.ts` covers.
 *
 * Behaviour locked here:
 *  - The hold MOVES: the old room is genuinely free afterwards (a competing
 *    allocation can now be written into it) and the new one genuinely busy (a
 *    competing allocation is rejected by `resource_no_overlap`). Asserted with
 *    the constraint itself, not by re-reading the row we just wrote.
 *  - The RANGE is preserved verbatim, turnaround tail included. A sideways drag
 *    must never change how long the room is blocked, and must never reschedule
 *    the client.
 *  - `source` becomes `manual`. That is what stops the auto-picker from
 *    "correcting" the front desk's choice on the next reschedule.
 *  - Only the NAMED category's hold moves. An appointment holding a room and a
 *    laser must not lose its laser because somebody dragged its room.
 *  - Busy target + no force ⇒ `CONFLICT` and NOTHING is written. A refused move
 *    that half-happened is worse than either outcome.
 *  - Busy target + `force` ⇒ written with `allowOverlap: true`, coexisting with
 *    the hold it overrides (warn-don't-block, as everywhere else in the console).
 *  - `capacity > 1` counts: the second concurrent hold needs no force, the
 *    (capacity+1)-th is refused. The DB constraint cannot count to N, so this is
 *    the ONLY thing standing between a 2-chair nail bar and a 3-chair booking.
 *  - Refused, never guessed: a target in another category, in another ORG,
 *    soft-deleted, or deactivated is rejected and nothing is written. A
 *    cross-org id must never become a cross-org write.
 *  - ASSIGN: a category holding NOTHING is not an error — it is the ordinary
 *    case for every booking made before the clinic set rooms up. A new hold is
 *    created, `source: 'manual'`, spanning the appointment's window plus
 *    whatever turnaround the category's requirement carries (there is no
 *    existing range to preserve, so the tail must be derived).
 *  - RELEASE (`resourceId: null`): the hold is dropped, the room is genuinely
 *    free afterwards, only the NAMED category is affected, and a second click
 *    is a success rather than an error.
 *  - A RELEASED hold frees the slot for the real booking GATE
 *    (`loadResourceGateContext` / `hasFreeResourcesFor`), not merely for the
 *    exclusion constraint — that is the freeing a customer would notice.
 *  - `NOT_FOUND` for an appointment that does not exist.
 *  - THE RACE: two moves onto the same free capacity-1 room resolve to exactly
 *    one winner and one CONFLICT — never two holds, never a raw PG error
 *    escaping as a 500. The service's pre-check is a check-then-write; the
 *    exclusion constraint is what makes the loser lose.
 *  - Moving a hold onto the room it ALREADY occupies is a no-op success. The
 *    hold must not be treated as its own competitor.
 *
 * CONCURRENCY: the ASSIGN path is a check-then-INSERT, and the two ways it
 * used to lose that race are covered below — two concurrent assigns leaving
 * the booking holding TWO rooms in one category, and the loser of a same-room
 * race surfacing as a 500 instead of a CONFLICT. Both are fixed (own
 * transaction + `FOR UPDATE`; 23505 mapped alongside 23P01) and asserted, not
 * pinned.
 *
 * ⚠️  ASYMMETRY, pinned deliberately (see `names the room` tests): a
 * DEACTIVATED target is refused with a message naming it ("Room 2 is
 * deactivated…"), but a SOFT-DELETED one falls into the generic
 * "not available in this category". Both are correct refusals; only one is
 * explainable to the person staring at the calendar.
 *
 * ⚠️  Every negative DB assertion goes through `capturePgError` — see its doc
 * comment in seeds/resources.ts for why `rejects.toThrow(/constraint/)` is a
 * trap with drizzle 0.45.2.
 */
import {
  appointmentResource,
  appointmentService,
  db,
  resource,
} from '@borradh-workspace/database';
import type { AppointmentResourceAllocationView } from '@borradh-workspace/features/resources';
import { reassignAppointmentResource } from '@borradh-workspace/features/resources';
import {
  hasFreeResourcesFor,
  loadResourceGateContext,
} from '@borradh-workspace/features/scheduling';
import { eq } from 'drizzle-orm';
import {
  seedAppointment,
  seedLead,
  seedOrganization,
  seedUser,
} from './harness.js';
import {
  allocationsFor,
  capturePgError,
  seedAllocation,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

/**
 * See appointment-double-booking.int-spec.ts: the literals encode only relative
 * structure and `at()` rebases the whole fixture onto a near-future anchor, so
 * nothing time-bombs when the wall clock passes the literal year.
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 8, 1); // earliest literal: 2026-09-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = '23P01';

const SLOT_START = at('2026-09-01T10:00:00.000Z');
const SLOT_END = at('2026-09-01T11:00:00.000Z');
/** The whole fixture day, the window the booking gate is loaded for. */
const DAY_START = at('2026-09-01T00:00:00.000Z');
const DAY_END = at('2026-09-02T00:00:00.000Z');

interface World {
  organizationId: string;
  leadId: string;
  categoryId: string;
  /** Room ids in `sortOrder` order; names are `Room 1`, `Room 2`, … */
  roomIds: string[];
}

/** An org with one resource CATEGORY ("Rooms") holding `rooms` capacity-1 rooms. */
async function seedWorld(
  opts: { rooms?: number; capacity?: number } = {}
): Promise<World> {
  const organizationId = await seedOrganization();
  const leadId = await seedLead({ organizationId });
  const categoryId = await seedResourceCategory({
    organizationId,
    name: 'Rooms',
  });

  const roomIds: string[] = [];
  for (let index = 0; index < (opts.rooms ?? 2); index += 1) {
    roomIds.push(
      await seedResource({
        organizationId,
        categoryId,
        name: `Room ${index + 1}`,
        sortOrder: index,
        capacity: opts.capacity ?? 1,
      })
    );
  }

  return { organizationId, leadId, categoryId, roomIds };
}

/**
 * A booking that HOLDS `resourceId` for [start, end + turnaround).
 *
 * A fresh assignee per booking, so two bookings in the same window never clash
 * on anything except the resource under test.
 */
async function seedBookingHolding(
  world: World,
  resourceId: string,
  opts: {
    start?: Date;
    end?: Date;
    turnaroundMinutes?: number;
    source?: 'auto' | 'manual';
    allowOverlap?: boolean;
    title?: string;
  } = {}
): Promise<{ appointmentId: string; allocationId: string }> {
  const start = opts.start ?? SLOT_START;
  const end = opts.end ?? SLOT_END;
  const turnaroundMinutes = opts.turnaroundMinutes ?? 0;
  const assignee = await seedUser();

  const appointmentId = await seedAppointment({
    organizationId: world.organizationId,
    assignedToId: assignee.id,
    leadId: world.leadId,
    title: opts.title ?? 'Booking',
    startDate: start,
    endDate: end,
  });

  const allocationId = await seedAllocation({
    organizationId: world.organizationId,
    appointmentId,
    resourceId,
    startDate: start,
    endDate: new Date(end.getTime() + turnaroundMinutes * 60_000),
    turnaroundMinutes,
    source: opts.source ?? 'auto',
    allowOverlap: opts.allowOverlap ?? false,
  });

  return { appointmentId, allocationId };
}

/**
 * Try to take `resourceId` for [SLOT_START, SLOT_END) with a brand-new booking,
 * WITHOUT opting out of the exclusion constraint. Resolves when the room was
 * free; rejects (with the PG error) when it was not.
 *
 * This is how "the old room is free" / "the new room is busy" are asserted:
 * by asking the DATABASE, rather than by re-reading the row the service just
 * wrote (which would pass whether or not the move really landed).
 */
async function tryToTake(world: World, resourceId: string): Promise<void> {
  const assignee = await seedUser();
  const appointmentId = await seedAppointment({
    organizationId: world.organizationId,
    assignedToId: assignee.id,
    leadId: world.leadId,
    title: 'Probe booking',
    startDate: SLOT_START,
    endDate: SLOT_END,
  });
  await seedAllocation({
    organizationId: world.organizationId,
    appointmentId,
    resourceId,
    startDate: SLOT_START,
    endDate: SLOT_END,
  });
}

/**
 * Put a service on the appointment's CART.
 *
 * `deriveHoldWindow` reads `appointment_service` to find which of the
 * appointment's services requires the category being assigned, and takes that
 * service's `turnaroundMinutes` as the new hold's cleanup tail. Without a cart
 * line there is no requirement to find and the tail is 0 — so a test asserting
 * the tail must seed one, or it would pass for the wrong reason.
 */
async function seedCartLine(
  appointmentId: string,
  serviceId: string
): Promise<void> {
  await db.insert(appointmentService).values({
    appointmentId,
    serviceId,
    name: 'Cart line',
    durationMinutes: 60,
  });
}

/**
 * Narrow a reassign Result to the allocation view a MOVE or ASSIGN must carry.
 *
 * The service returns `Result<AppointmentResourceAllocationView | null>` — the
 * `null` belongs to the RELEASE path, where nothing is held any more. Any other
 * call returning null is a bug, so it fails here loudly rather than being
 * swallowed by an optional chain that would make every field assertion below it
 * vacuous.
 */
function viewOf(
  result: Awaited<ReturnType<typeof reassignAppointmentResource>>
): AppointmentResourceAllocationView {
  if (!result.success) {
    throw new Error(
      `reassign failed: ${result.error.code} ${result.error.message}`
    );
  }
  if (result.data === null) {
    throw new Error('expected an allocation view, got null (RELEASE path?)');
  }
  return result.data;
}

describe('Phase 7 §7f — reassignAppointmentResource', () => {
  /* ------------------------------------------------------------------ */
  /* The move itself                                                     */
  /* ------------------------------------------------------------------ */

  it('moves the hold: the old room becomes free and the new one busy', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    const booking = await seedBookingHolding(world, room1);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(viewOf(result).resourceId).toBe(room2);
    expect(viewOf(result).resourceName).toBe('Room 2');
    expect(viewOf(result).id).toBe(booking.allocationId);

    // The row itself moved — one hold, on Room 2.
    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room2);

    // ROOM 1 IS FREE: a competing booking can now take it.
    await expect(tryToTake(world, room1)).resolves.toBeUndefined();

    // ROOM 2 IS BUSY: the same attempt is refused by the DB backstop.
    const error = await capturePgError(() => tryToTake(world, room2));
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(error.constraint_name).toBe('resource_no_overlap');
  });

  it('preserves the hold range EXACTLY, turnaround tail included', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    // 60-minute booking + a 15-minute cleanup tail: the hold runs to 11:15.
    const booking = await seedBookingHolding(world, room1, {
      turnaroundMinutes: 15,
    });

    const before = await allocationsFor(booking.appointmentId);
    expect(before[0].endDate.getTime()).toBe(SLOT_END.getTime() + 15 * 60_000);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    // Returned view and persisted row agree, to the millisecond.
    expect(viewOf(result).startDate.getTime()).toBe(SLOT_START.getTime());
    expect(viewOf(result).endDate.getTime()).toBe(
      SLOT_END.getTime() + 15 * 60_000
    );
    expect(viewOf(result).turnaroundMinutes).toBe(15);

    const after = await allocationsFor(booking.appointmentId);
    expect(after).toHaveLength(1);
    expect(after[0].startDate.getTime()).toBe(before[0].startDate.getTime());
    expect(after[0].endDate.getTime()).toBe(before[0].endDate.getTime());
    expect(after[0].turnaroundMinutes).toBe(15);

    // The tail really is still held: a booking that only overlaps the
    // turnaround minutes (11:05–11:10) cannot take Room 2.
    const assignee = await seedUser();
    const tailProbe = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: assignee.id,
      leadId: world.leadId,
      title: 'Tail probe',
      startDate: at('2026-09-01T11:05:00.000Z'),
      endDate: at('2026-09-01T11:10:00.000Z'),
    });
    const error = await capturePgError(() =>
      seedAllocation({
        organizationId: world.organizationId,
        appointmentId: tailProbe,
        resourceId: room2,
        startDate: at('2026-09-01T11:05:00.000Z'),
        endDate: at('2026-09-01T11:10:00.000Z'),
      })
    );
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(error.constraint_name).toBe('resource_no_overlap');
  });

  it("marks the hold `manual` so the auto-picker cannot undo the operator's choice", async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    const booking = await seedBookingHolding(world, room1, { source: 'auto' });

    const before = await allocationsFor(booking.appointmentId);
    expect(before[0].source).toBe('auto');

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(viewOf(result).source).toBe('manual');

    const after = await allocationsFor(booking.appointmentId);
    expect(after[0].source).toBe('manual');
  });

  it("moves ONLY the named category's hold — the laser stays put", async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;

    const deviceCategoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Devices',
      kind: 'equipment',
    });
    const laserId = await seedResource({
      organizationId: world.organizationId,
      categoryId: deviceCategoryId,
      name: 'Laser A',
    });

    const booking = await seedBookingHolding(world, room1);
    // The same appointment also holds a device for the same window.
    await seedAllocation({
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      resourceId: laserId,
      startDate: SLOT_START,
      endDate: SLOT_END,
      source: 'auto',
    });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });
    expect(result.success).toBe(true);

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(2);

    const room = held.find((row) => row.resourceId === room2);
    const laser = held.find((row) => row.resourceId === laserId);
    expect(room).toBeDefined();
    // Untouched: still the laser, still auto-assigned, still the same window.
    expect(laser).toBeDefined();
    expect(laser?.source).toBe('auto');
    expect(laser?.startDate.getTime()).toBe(SLOT_START.getTime());
    expect(laser?.endDate.getTime()).toBe(SLOT_END.getTime());
    // And Room 1 is no longer held by anything on this appointment.
    expect(held.some((row) => row.resourceId === room1)).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* Conflicts                                                           */
  /* ------------------------------------------------------------------ */

  it('refuses a busy target with CONFLICT and writes NOTHING', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    const mover = await seedBookingHolding(world, room1, { title: 'Mover' });
    const occupant = await seedBookingHolding(world, room2, {
      title: 'Occupant',
    });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: mover.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a busy target to be refused');
    expect(result.error.code).toBe('CONFLICT');
    // Named, so the UI can say WHICH room and offer the override.
    expect(result.error.message).toContain('Room 2');

    // Nothing written: the mover still holds Room 1, still auto-assigned,
    // still opted IN to the exclusion constraint.
    const held = await allocationsFor(mover.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
    expect(held[0].source).toBe('auto');
    expect(held[0].allowOverlap).toBe(false);

    // And the occupant is undisturbed.
    const occupantHeld = await allocationsFor(occupant.appointmentId);
    expect(occupantHeld).toHaveLength(1);
    expect(occupantHeld[0].resourceId).toBe(room2);
  });

  it('force overrides a busy target and opts the hold out of the constraint', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    const mover = await seedBookingHolding(world, room1, { title: 'Mover' });
    const occupant = await seedBookingHolding(world, room2, {
      title: 'Occupant',
    });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: mover.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
      force: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(viewOf(result).resourceId).toBe(room2);
    expect(viewOf(result).allowOverlap).toBe(true);
    expect(viewOf(result).source).toBe('manual');

    const held = await allocationsFor(mover.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room2);
    expect(held[0].allowOverlap).toBe(true);

    // Both holds coexist on Room 2 — that IS the override.
    const occupantHeld = await allocationsFor(occupant.appointmentId);
    expect(occupantHeld[0].resourceId).toBe(room2);
    expect(occupantHeld[0].allowOverlap).toBe(false);
  });

  it('capacity > 1: the second hold needs no force, the third is refused', async () => {
    // Three parking rooms (capacity 1) the movers start in, plus one shared
    // 2-capacity space they all try to move into.
    const world = await seedWorld({ rooms: 3 });
    const shared = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      name: 'Double Room',
      capacity: 2,
      sortOrder: 9,
    });

    const first = await seedBookingHolding(world, world.roomIds[0]);
    const second = await seedBookingHolding(world, world.roomIds[1]);
    const third = await seedBookingHolding(world, world.roomIds[2]);

    const move = (appointmentId: string) =>
      reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId,
        categoryId: world.categoryId,
        resourceId: shared,
      });

    const one = await move(first.appointmentId);
    expect(one.success).toBe(true);
    if (!one.success) throw new Error(one.error.message);
    // Every hold on a shared resource opts out of the constraint — a plain
    // exclusion constraint cannot count to N.
    expect(viewOf(one).allowOverlap).toBe(true);

    // SECOND concurrent hold: allowed, no force.
    const two = await move(second.appointmentId);
    expect(two.success).toBe(true);
    if (!two.success) throw new Error(two.error.message);
    expect(viewOf(two).allowOverlap).toBe(true);

    // THIRD: over capacity. Only the service layer can catch this.
    const three = await move(third.appointmentId);
    expect(three.success).toBe(false);
    if (three.success) throw new Error('expected the 3rd hold to be refused');
    expect(three.error.code).toBe('CONFLICT');
    expect(three.error.message).toContain('Double Room');

    // The refused booking is still parked where it was.
    const thirdHeld = await allocationsFor(third.appointmentId);
    expect(thirdHeld[0].resourceId).toBe(world.roomIds[2]);
  });

  /* ------------------------------------------------------------------ */
  /* Refusals: the target is not a thing this move may use               */
  /* ------------------------------------------------------------------ */

  it('refuses a target in a DIFFERENT category (VALIDATION_ERROR, nothing written)', async () => {
    const world = await seedWorld({ rooms: 1 });
    const [room1] = world.roomIds;
    const deviceCategoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Devices',
      kind: 'equipment',
    });
    const laserId = await seedResource({
      organizationId: world.organizationId,
      categoryId: deviceCategoryId,
      name: 'Laser A',
    });
    const booking = await seedBookingHolding(world, room1);

    // "Move the ROOM slot into the laser" — a stale UI could ask for this.
    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: laserId,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a cross-category refusal');
    expect(result.error.code).toBe('VALIDATION_ERROR');

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
  });

  it("refuses another ORG's resource and never writes across the boundary", async () => {
    const mine = await seedWorld({ rooms: 1 });
    const theirs = await seedWorld({ rooms: 1 });
    const booking = await seedBookingHolding(mine, mine.roomIds[0]);

    // (a) foreign resource id, my category id.
    const withMyCategory = await reassignAppointmentResource(db, {
      organizationId: mine.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: mine.categoryId,
      resourceId: theirs.roomIds[0],
    });
    expect(withMyCategory.success).toBe(false);
    if (withMyCategory.success) throw new Error('expected a cross-org refusal');
    expect(['VALIDATION_ERROR', 'NOT_FOUND']).toContain(
      withMyCategory.error.code
    );

    // (b) foreign resource id AND foreign category id — the shape a leaked
    //     payload would actually have.
    const withTheirCategory = await reassignAppointmentResource(db, {
      organizationId: mine.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: theirs.categoryId,
      resourceId: theirs.roomIds[0],
    });
    expect(withTheirCategory.success).toBe(false);
    if (withTheirCategory.success)
      throw new Error('expected a cross-org refusal');
    expect(['VALIDATION_ERROR', 'NOT_FOUND']).toContain(
      withTheirCategory.error.code
    );

    // NO CROSS-ORG WRITE: my hold is untouched and nothing in my org points at
    // their room.
    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(mine.roomIds[0]);
    expect(held[0].source).toBe('auto');
  });

  it('refuses a SOFT-DELETED target (generic refusal — it no longer has a name to give)', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    await db
      .update(resource)
      .set({ deletedAt: new Date() })
      .where(eq(resource.id, room2));
    const booking = await seedBookingHolding(world, room1);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });

    expect(result.success).toBe(false);
    if (result.success)
      throw new Error('expected a deleted room to be refused');
    expect(result.error.code).toBe('VALIDATION_ERROR');
    // ⚠️  PINNED ASYMMETRY: a deleted target is refused generically, unlike a
    // deactivated one below. See the file header.
    expect(result.error.message).toBe(
      'That room is not available in this category'
    );

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
  });

  it('refuses a DEACTIVATED target with a message naming the room', async () => {
    const world = await seedWorld({ rooms: 1 });
    const [room1] = world.roomIds;
    const retiredId = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      name: 'Retired Room',
      isActive: false,
    });
    const booking = await seedBookingHolding(world, room1);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: retiredId,
    });

    expect(result.success).toBe(false);
    if (result.success)
      throw new Error('expected a deactivated room to be refused');
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.message).toContain('Retired Room');
    expect(result.error.message).toContain('deactivated');

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
  });

  /* ------------------------------------------------------------------ */
  /* Refusals: there is nothing here to move                             */
  /* ------------------------------------------------------------------ */

  it('ASSIGNS when the booking holds nothing in that category (no existing hold to move)', async () => {
    const world = await seedWorld({ rooms: 1 });
    const deviceCategoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Devices',
      kind: 'equipment',
    });
    const laserId = await seedResource({
      organizationId: world.organizationId,
      categoryId: deviceCategoryId,
      name: 'Laser A',
    });

    // Holds a LASER, nothing in Rooms. This is every booking made before the
    // clinic set rooms up, and every service that requires no room but is
    // physically going to occupy one anyway.
    const booking = await seedBookingHolding(world, laserId);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: world.roomIds[0],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data).not.toBeNull();
    // A NEW row, not the laser's hold repurposed.
    expect(viewOf(result).id).not.toBe(booking.allocationId);
    expect(viewOf(result).resourceId).toBe(world.roomIds[0]);
    expect(viewOf(result).source).toBe('manual');
    // No cart line requires this category, so there is no cleanup tail to add:
    // the hold is exactly the appointment's own window.
    expect(viewOf(result).turnaroundMinutes).toBe(0);
    expect(viewOf(result).startDate.getTime()).toBe(SLOT_START.getTime());
    expect(viewOf(result).endDate.getTime()).toBe(SLOT_END.getTime());

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(2);
    // The laser is untouched — an assign in one category must not disturb another.
    const laser = held.find((row) => row.resourceId === laserId);
    expect(laser?.source).toBe('auto');

    // The room is now genuinely held.
    const error = await capturePgError(() =>
      tryToTake(world, world.roomIds[0])
    );
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(error.constraint_name).toBe('resource_no_overlap');
  });

  it("derives a NEW hold's turnaround tail from the category's requirement", async () => {
    const world = await seedWorld({ rooms: 1 });
    // A cart line whose service requires a room and carries a 20-minute
    // cleanup tail. A first-time assign has no range to preserve, so this is
    // where the tail has to come from.
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
      turnaroundMinutes: 20,
    });
    await seedRequirement({
      organizationId: world.organizationId,
      serviceId,
      categoryId: world.categoryId,
    });

    const assignee = await seedUser();
    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: assignee.id,
      leadId: world.leadId,
      title: 'Needs a room',
      startDate: SLOT_START,
      endDate: SLOT_END,
    });
    await seedCartLine(appointmentId, serviceId);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId,
      categoryId: world.categoryId,
      resourceId: world.roomIds[0],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(viewOf(result).turnaroundMinutes).toBe(20);
    expect(viewOf(result).endDate.getTime()).toBe(
      SLOT_END.getTime() + 20 * 60_000
    );

    // The tail is really held: a booking that overlaps ONLY the cleanup
    // minutes (11:05–11:10) cannot take the room.
    const probeAssignee = await seedUser();
    const probeId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: probeAssignee.id,
      leadId: world.leadId,
      title: 'Tail probe',
      startDate: at('2026-09-01T11:05:00.000Z'),
      endDate: at('2026-09-01T11:10:00.000Z'),
    });
    const error = await capturePgError(() =>
      seedAllocation({
        organizationId: world.organizationId,
        appointmentId: probeId,
        resourceId: world.roomIds[0],
        startDate: at('2026-09-01T11:05:00.000Z'),
        endDate: at('2026-09-01T11:10:00.000Z'),
      })
    );
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(error.constraint_name).toBe('resource_no_overlap');
  });

  it('refuses to ASSIGN a busy room and inserts nothing', async () => {
    const world = await seedWorld({ rooms: 1 });
    await seedBookingHolding(world, world.roomIds[0], { title: 'Occupant' });

    const assignee = await seedUser();
    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: assignee.id,
      leadId: world.leadId,
      title: 'Holds nothing',
      startDate: SLOT_START,
      endDate: SLOT_END,
    });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId,
      categoryId: world.categoryId,
      resourceId: world.roomIds[0],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a busy room to be refused');
    expect(result.error.code).toBe('CONFLICT');
    expect(result.error.message).toContain('Room 1');

    // A refused ASSIGN must not leave a half-written hold behind.
    expect(await allocationsFor(appointmentId)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ */
  /* Release (resourceId: null)                                          */
  /* ------------------------------------------------------------------ */

  it('RELEASES the hold and frees the room', async () => {
    const world = await seedWorld({ rooms: 1 });
    const booking = await seedBookingHolding(world, world.roomIds[0]);

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    // Nothing is held any more, so there is no allocation view to return.
    expect(result.data).toBeNull();

    expect(await allocationsFor(booking.appointmentId)).toHaveLength(0);
    // The room really is free — the whole point of having an unassign at all.
    await expect(tryToTake(world, world.roomIds[0])).resolves.toBeUndefined();
  });

  it('RELEASE is idempotent — a second click is not an error', async () => {
    const world = await seedWorld({ rooms: 1 });
    const booking = await seedBookingHolding(world, world.roomIds[0]);

    const release = () =>
      reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId: booking.appointmentId,
        categoryId: world.categoryId,
        resourceId: null,
      });

    expect((await release()).success).toBe(true);
    const second = await release();
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error.message);
    expect(second.data).toBeNull();
    expect(await allocationsFor(booking.appointmentId)).toHaveLength(0);
  });

  it("RELEASE drops ONLY the named category's hold", async () => {
    const world = await seedWorld({ rooms: 1 });
    const deviceCategoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Devices',
      kind: 'equipment',
    });
    const laserId = await seedResource({
      organizationId: world.organizationId,
      categoryId: deviceCategoryId,
      name: 'Laser A',
    });
    const booking = await seedBookingHolding(world, world.roomIds[0]);
    await seedAllocation({
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      resourceId: laserId,
      startDate: SLOT_START,
      endDate: SLOT_END,
      source: 'auto',
    });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: null,
    });
    expect(result.success).toBe(true);

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(laserId);
    expect(held[0].source).toBe('auto');
  });

  it('NOT_FOUND for an unknown appointment id', async () => {
    const world = await seedWorld({ rooms: 1 });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: 'appt_does_not_exist',
      categoryId: world.categoryId,
      resourceId: world.roomIds[0],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected NOT_FOUND');
    expect(result.error.code).toBe('NOT_FOUND');
    expect(result.error.message).toBe('Appointment not found');
  });

  it('a RELEASED hold frees the slot for the booking GATE, not just for the constraint', async () => {
    // The exclusion constraint proves the row is gone; the GATE is what a
    // customer actually meets. `resolveResourceAvailability` never joins back
    // to appointment status, so a release that leaves the row behind would
    // keep the slot unbookable forever with nothing in the UI able to free it.
    const world = await seedWorld({ rooms: 1 });
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
    });
    await seedRequirement({
      organizationId: world.organizationId,
      serviceId,
      categoryId: world.categoryId,
    });

    const slotIsFree = async () => {
      const ctx = await loadResourceGateContext(db, {
        organizationId: world.organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
      });
      if (ctx === null) throw new Error('the service under test is not gated');
      return hasFreeResourcesFor(ctx, SLOT_START, SLOT_END);
    };

    const booking = await seedBookingHolding(world, world.roomIds[0]);
    // The clinic's only room is held, so the slot is not servable.
    expect(await slotIsFree()).toBe(false);

    const released = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: null,
    });
    expect(released.success).toBe(true);

    expect(await slotIsFree()).toBe(true);
  });

  it('release then re-assign puts the booking back in the same room', async () => {
    const world = await seedWorld({ rooms: 1 });
    const booking = await seedBookingHolding(world, world.roomIds[0], {
      turnaroundMinutes: 15,
    });

    const released = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: null,
    });
    expect(released.success).toBe(true);
    expect(await allocationsFor(booking.appointmentId)).toHaveLength(0);

    const reassigned = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: world.roomIds[0],
    });
    expect(reassigned.success).toBe(true);
    const view = viewOf(reassigned);
    expect(view.resourceId).toBe(world.roomIds[0]);
    // A brand-new row, not a resurrection of the deleted one.
    expect(view.id).not.toBe(booking.allocationId);
    // The 15-minute tail the ORIGINAL hold carried is NOT restored, and that
    // is correct: a re-assign has no range to preserve, so it re-derives the
    // tail from the cart. Nothing in this fixture's cart requires the
    // category, so the tail is 0. Worth pinning because it means
    // release-then-reassign is only lossless while the requirement that
    // produced the tail still exists — delete the requirement (or the cart
    // line) and the room silently stops being held for cleanup.
    expect(view.turnaroundMinutes).toBe(0);
    expect(view.endDate.getTime()).toBe(SLOT_END.getTime());

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(world.roomIds[0]);
  });

  it('capacity counting on the INSERT path: no current hold to exclude', async () => {
    // The clash query excludes `current.id` only when a hold exists to move.
    // On the ASSIGN path there is none, so every overlapping hold counts —
    // getting that branch wrong would either over-count (nothing assignable)
    // or under-count (a 3rd booking in a 2-person room).
    const world = await seedWorld({ rooms: 0 });
    const shared = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      name: 'Double Room',
      capacity: 2,
    });
    // One existing occupant, from a DIFFERENT appointment.
    await seedBookingHolding(world, shared, {
      title: 'Occupant',
      allowOverlap: true,
    });

    const assignFreshBooking = async (title: string) => {
      const assignee = await seedUser();
      const appointmentId = await seedAppointment({
        organizationId: world.organizationId,
        assignedToId: assignee.id,
        leadId: world.leadId,
        title,
        startDate: SLOT_START,
        endDate: SLOT_END,
      });
      const result = await reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId,
        categoryId: world.categoryId,
        resourceId: shared,
      });
      return { appointmentId, result };
    };

    // 1 existing < capacity 2 → the second seat is assignable.
    const second = await assignFreshBooking('Second seat');
    expect(second.result.success).toBe(true);
    expect(viewOf(second.result).allowOverlap).toBe(true);

    // 2 existing >= capacity 2 → the third is refused, and nothing is written.
    const third = await assignFreshBooking('Third seat');
    expect(third.result.success).toBe(false);
    if (third.result.success) throw new Error('expected the 3rd to be refused');
    expect(third.result.error.code).toBe('CONFLICT');
    expect(third.result.error.message).toContain('Double Room');
    expect(await allocationsFor(third.appointmentId)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ */
  /* The race                                                            */
  /* ------------------------------------------------------------------ */

  it('two concurrent moves onto the same free room: exactly one wins, the loser gets CONFLICT', async () => {
    const world = await seedWorld({ rooms: 2 });
    const target = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      name: 'Contested Room',
      sortOrder: 9,
    });
    const a = await seedBookingHolding(world, world.roomIds[0], {
      title: 'Racer A',
    });
    const b = await seedBookingHolding(world, world.roomIds[1], {
      title: 'Racer B',
    });

    const settled = await Promise.allSettled([
      reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId: a.appointmentId,
        categoryId: world.categoryId,
        resourceId: target,
      }),
      reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId: b.appointmentId,
        categoryId: world.categoryId,
        resourceId: target,
      }),
    ]);

    // NEVER a raw rejection: the service returns a Result, always.
    expect(settled.every((entry) => entry.status === 'fulfilled')).toBe(true);
    const results = settled.map((entry) =>
      entry.status === 'fulfilled'
        ? entry.value
        : (() => {
            throw new Error(
              `reassign REJECTED instead of returning a Result: ${String(
                entry.reason
              )}`
            );
          })()
    );

    const winners = results.filter((result) => result.success);
    const losers = results.filter((result) => !result.success);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loser = losers[0];
    if (loser.success) throw new Error('unreachable');
    // The loser must be a domain conflict — never INTERNAL_ERROR, which is
    // what a leaked 23P01 would produce.
    expect(loser.error.code).toBe('CONFLICT');

    // And the DB agrees: exactly one of the two ended up in the contested room.
    const heldA = await allocationsFor(a.appointmentId);
    const heldB = await allocationsFor(b.appointmentId);
    const inTarget = [heldA[0], heldB[0]].filter(
      (row) => row.resourceId === target
    );
    expect(inTarget).toHaveLength(1);
    // The loser is still parked where it started.
    const parked = [heldA[0], heldB[0]].filter((row) =>
      world.roomIds.includes(row.resourceId)
    );
    expect(parked).toHaveLength(1);
  });

  /**
   * THE ASSIGN RACE.
   *
   * `reassignAppointmentResource` reads the category's current hold, finds
   * none, and inserts. Two requests interleaving between that read and that
   * insert both take the ASSIGN branch, and NOTHING in the schema stops them:
   * `appointment_resource_unique` is (appointment_id, resource_id) and
   * `resource_no_overlap` is (resource_id, range) WHERE NOT allow_overlap —
   * there is no uniqueness on (appointment_id, category_id).
   *
   * This is not exotic. A double-click on the room dropdown, a retried
   * request, or two people on the same booking all produce it.
   *
   * It is held shut by the service opening its OWN transaction and taking
   * `SELECT … FOR UPDATE` on the appointment row — not by `withOrgScope`,
   * which passes straight through with no transaction when RLS is disabled.
   * The two tests below are the reason that lock exists; they fail without it.
   */
  it('two concurrent ASSIGNs of DIFFERENT rooms leave exactly ONE hold', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [roomA, roomB] = world.roomIds;
    const assignee = await seedUser();
    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: assignee.id,
      leadId: world.leadId,
      title: 'Holds nothing yet',
      startDate: SLOT_START,
      endDate: SLOT_END,
    });

    const assign = (resourceId: string) =>
      reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId,
        categoryId: world.categoryId,
        resourceId,
      });

    await Promise.allSettled([assign(roomA), assign(roomB)]);

    // THE INVARIANT: an appointment holds at most ONE resource per category.
    // This used to read 2 — the booking silently occupied two rooms, one of
    // which the UI could never target again (`current` is a `.limit(1)` with
    // no ORDER BY, and RELEASE deletes only one of them), so it stayed held
    // until the appointment was cancelled. Serialised now by the service's
    // own transaction + `SELECT … FOR UPDATE` on the appointment row.
    const held = await allocationsFor(appointmentId);
    expect(held).toHaveLength(1);
  });

  it('the loser of two concurrent ASSIGNs of the SAME room gets CONFLICT, not a 500', async () => {
    const world = await seedWorld({ rooms: 0 });
    // Capacity 2 so the hold is written `allowOverlap: true` and is therefore
    // OUTSIDE `resource_no_overlap`. That leaves `appointment_resource_unique`
    // as the only constraint in play, which makes the failure deterministic:
    // at capacity 1 the two constraints race and the outcome flips between a
    // (correct) CONFLICT and a (wrong) 500.
    const shared = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      name: 'Double Room',
      capacity: 2,
    });
    const assignee = await seedUser();
    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: assignee.id,
      leadId: world.leadId,
      title: 'Double-clicked',
      startDate: SLOT_START,
      endDate: SLOT_END,
    });

    const assign = () =>
      reassignAppointmentResource(db, {
        organizationId: world.organizationId,
        appointmentId,
        categoryId: world.categoryId,
        resourceId: shared,
      });

    const settled = await Promise.allSettled([assign(), assign()]);
    const codes = settled.map((entry) =>
      entry.status === 'fulfilled'
        ? entry.value.success
          ? 'OK'
          : entry.value.error.code
        : 'REJECTED'
    );

    // THE INVARIANT: a double-click is either an idempotent success or a
    // CONFLICT the client can render. Never a 500 — there is nothing the
    // front desk can do with "Failed to move the booking".
    expect(codes).not.toContain('INTERNAL_ERROR');
    expect(codes).not.toContain('REJECTED');
  });

  /* ------------------------------------------------------------------ */
  /* The degenerate move                                                 */
  /* ------------------------------------------------------------------ */

  it('moving a hold onto the room it ALREADY occupies is a no-op success', async () => {
    const world = await seedWorld({ rooms: 1 });
    const [room1] = world.roomIds;
    const booking = await seedBookingHolding(world, room1, {
      turnaroundMinutes: 10,
      source: 'auto',
    });

    const result = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: booking.appointmentId,
      categoryId: world.categoryId,
      resourceId: room1,
    });

    // The hold must not be treated as its own competitor.
    expect(result.success).toBe(true);
    if (!result.success)
      throw new Error(`self-move refused: ${result.error.message}`);
    expect(viewOf(result).resourceId).toBe(room1);
    expect(viewOf(result).allowOverlap).toBe(false);

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
    expect(held[0].startDate.getTime()).toBe(SLOT_START.getTime());
    expect(held[0].endDate.getTime()).toBe(SLOT_END.getTime() + 10 * 60_000);
    expect(held[0].turnaroundMinutes).toBe(10);
    // It is now an operator decision, so the auto-picker must leave it alone.
    expect(held[0].source).toBe('manual');
  });

  it('re-affirming a FORCED hold once the clash clears drops allowOverlap back to false', async () => {
    const world = await seedWorld({ rooms: 2 });
    const [room1, room2] = world.roomIds;
    const mover = await seedBookingHolding(world, room1, { title: 'Mover' });
    const occupant = await seedBookingHolding(world, room2, {
      title: 'Occupant',
    });

    // Force the mover on top of the occupant.
    const forced = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: mover.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
      force: true,
    });
    expect(forced.success).toBe(true);

    // The occupant leaves (its booking is cancelled → the hold is released).
    // Deleted directly: this spec is not testing the release path
    // (resource-allocation-lifecycle covers that), only that Room 2 frees up.
    await db
      .delete(appointmentResource)
      .where(eq(appointmentResource.appointmentId, occupant.appointmentId));

    // Re-affirm the same room WITHOUT force. The hold must come back under the
    // exclusion constraint's protection, and must not collide with ITSELF.
    const reaffirmed = await reassignAppointmentResource(db, {
      organizationId: world.organizationId,
      appointmentId: mover.appointmentId,
      categoryId: world.categoryId,
      resourceId: room2,
    });

    expect(reaffirmed.success).toBe(true);
    if (!reaffirmed.success)
      throw new Error(`re-affirm refused: ${reaffirmed.error.message}`);
    expect(viewOf(reaffirmed).allowOverlap).toBe(false);

    const held = await allocationsFor(mover.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room2);
    expect(held[0].allowOverlap).toBe(false);

    // …and Room 2 is now properly guarded again.
    const error = await capturePgError(() => tryToTake(world, room2));
    expect(error.code).toBe(EXCLUSION_VIOLATION);
    expect(error.constraint_name).toBe('resource_no_overlap');
  });
});
