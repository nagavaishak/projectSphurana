/**
 * Phase 7 §7d — the allocation lifecycle invariant.
 *
 *     An `appointment_resource` row exists ONLY while its appointment is active.
 *
 * `resolveResourceAvailability` — the query behind every slot list, every
 * availability check and every allocation decision — deliberately does NOT join
 * back to `appointment.status`. That omission is what makes it one indexed
 * range query instead of a join across the busiest table in the schema, and it
 * is sound ONLY because of the invariant above.
 *
 * Miss one release path and the failure is silent and permanent. The
 * appointment vanishes from the calendar; its room stays held, forever, against
 * every future booking. Nobody ever reports "the room I cancelled is still
 * busy" — months later somebody reports "we can't book Tuesdays any more", and
 * in the meantime the clinic has quietly been selling less than it can deliver.
 * There is no self-healing path: nothing ever revisits an orphaned row.
 *
 * Behaviour locked here:
 *  - Creating an appointment for a gated service writes exactly ONE allocation
 *    per required category, spanning [start, end + turnaround).
 *  - Every transition out of an active status frees them, and the freed slot is
 *    immediately offerable again: cancel · no-show · soft-delete · deposit
 *    expiry. Each is asserted independently, because each is a separate call
 *    site and it is the FORGOTTEN one that causes the outage.
 *  - Reschedule releases before it re-takes, so the appointment cannot conflict
 *    with its own old hold — a constraint `excludeAppointmentIds` cannot help
 *    with, since it filters the query and not the exclusion constraint.
 *  - A resource a HUMAN chose is kept across a move when it is still free, and
 *    swapped with a warning naming the clash when it is not. Moving a booking
 *    by ten minutes must not silently take the front desk's room away from it.
 *  - THE SWEEP: after a mixed book / cancel / no-show / reschedule / delete /
 *    deposit-expiry sequence, ZERO allocations remain whose appointment is not
 *    active. This is the assertion that would catch a NEW status transition
 *    added later without a release.
 */
import { appointmentResource, db } from '@borradh-workspace/database';
import {
  createAppointment,
  deleteAppointment,
  expireAppointmentDeposit,
  updateAppointment,
} from '@borradh-workspace/features/appointments';
import {
  hasFreeResourcesFor,
  loadResourceGateContext,
} from '@borradh-workspace/features/scheduling';
import { eq } from 'drizzle-orm';
import { seedLead, seedOrganization, seedUser } from './harness.js';
import { seedDeposit } from './seeds/deposits.js';
import {
  allocationsFor,
  orphanedAllocations,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

/**
 * See appointment-double-booking.int-spec.ts: the literals encode only relative
 * structure, and `at()` rebases the whole fixture onto a near-future anchor so
 * create-appointment's past-booking backstop never fires and nothing
 * time-bombs when the wall clock passes the literal year.
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 5, 1); // earliest literal: 2026-06-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

const DAY_START = at('2026-06-01T00:00:00.000Z');
const DAY_END = at('2026-06-02T00:00:00.000Z');

interface World {
  organizationId: string;
  assigneeId: string;
  leadId: string;
  serviceId: string;
  categoryId: string;
  /** Resource ids in `sortOrder` order — index 0 is the auto-picker's first choice. */
  roomIds: string[];
}

/** An org whose one service requires one room, with `roomCount` rooms in it. */
async function seedWorld(
  roomCount = 1,
  opts: { turnaroundMinutes?: number } = {}
): Promise<World> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const leadId = await seedLead({ organizationId });
  const serviceId = await seedResourceService({
    organizationId,
    appointmentDuration: 60,
    turnaroundMinutes: opts.turnaroundMinutes ?? null,
  });
  const categoryId = await seedResourceCategory({
    organizationId,
    name: 'Rooms',
  });

  const roomIds: string[] = [];
  for (let i = 0; i < roomCount; i += 1) {
    roomIds.push(
      await seedResource({
        organizationId,
        categoryId,
        name: `Room ${i + 1}`,
        sortOrder: i,
      })
    );
  }

  await seedRequirement({ organizationId, serviceId, categoryId });
  return {
    organizationId,
    assigneeId: assignee.id,
    leadId,
    serviceId,
    categoryId,
    roomIds,
  };
}

/** Book through the console path (the default `source: 'manual'`). */
const book = (
  world: World,
  input: {
    title: string;
    startDate: Date;
    endDate: Date;
    resourceIds?: string[];
    status?: 'booked' | 'held';
  }
) =>
  createAppointment(db, {
    title: input.title,
    startDate: input.startDate,
    endDate: input.endDate,
    leadId: world.leadId,
    assignedToId: world.assigneeId,
    organizationId: world.organizationId,
    serviceId: world.serviceId,
    resourceIds: input.resourceIds,
    status: input.status,
  });

/** Every allocation row in the org, regardless of which appointment owns it. */
async function allocationCount(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: appointmentResource.id })
    .from(appointmentResource)
    .where(eq(appointmentResource.organizationId, organizationId));
  return rows.length;
}

/**
 * Is the fixture slot servable again? Asked of the REAL gate, not of the row
 * count — releasing the row is only interesting because it makes the time
 * bookable, and this is the assertion a customer would notice.
 */
async function slotIsFree(
  world: World,
  start = at('2026-06-01T10:00:00.000Z'),
  end = at('2026-06-01T11:00:00.000Z')
): Promise<boolean> {
  const ctx = await loadResourceGateContext(db, {
    organizationId: world.organizationId,
    serviceIds: [world.serviceId],
    from: DAY_START,
    to: DAY_END,
    timeZone: 'UTC',
  });
  if (ctx === null) throw new Error('the service under test is not gated');
  return hasFreeResourcesFor(ctx, start, end);
}

describe('Phase 7 §7d — allocation lifecycle', () => {
  it('create writes one allocation per required category, spanning the hold (not the appointment)', async () => {
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const serviceId = await seedResourceService({
      organizationId,
      appointmentDuration: 60,
      turnaroundMinutes: 10,
    });
    const roomsId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const lasersId = await seedResourceCategory({
      organizationId,
      name: 'Lasers',
      kind: 'equipment',
    });
    const room = await seedResource({
      organizationId,
      categoryId: roomsId,
      name: 'Room 1',
    });
    const laser = await seedResource({
      organizationId,
      categoryId: lasersId,
      name: 'Laser 1',
    });
    // Two rooms in the Rooms category, to prove ONE is taken per category —
    // not one per resource, and not one per service line.
    await seedResource({
      organizationId,
      categoryId: roomsId,
      name: 'Room 2',
      sortOrder: 1,
    });
    for (const categoryId of [roomsId, lasersId]) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }

    const created = await createAppointment(db, {
      title: 'Needs a room and a laser',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
      leadId,
      assignedToId: assignee.id,
      organizationId,
      serviceId,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(2);
    expect(holds.map((hold) => hold.resourceId).sort()).toEqual(
      [room, laser].sort()
    );
    for (const hold of holds) {
      expect(hold.startDate.toISOString()).toBe(
        at('2026-06-01T10:00:00.000Z').toISOString()
      );
      // end + turnaround: the hold outlives the appointment by the cleanup tail.
      expect(hold.endDate.toISOString()).toBe(
        at('2026-06-01T11:10:00.000Z').toISOString()
      );
      expect(hold.turnaroundMinutes).toBe(10);
      expect(hold.source).toBe('auto');
    }
  });

  it('cancel releases the holds and the slot is immediately offerable again', async () => {
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'To be cancelled',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    expect(await allocationsFor(created.data.id)).toHaveLength(1);
    expect(await slotIsFree(world)).toBe(false);

    const cancelled = await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      status: 'cancelled',
    });
    expect(cancelled.success).toBe(true);

    expect(await allocationsFor(created.data.id)).toEqual([]);
    expect(await slotIsFree(world)).toBe(true);
  });

  it('no-show releases the holds', async () => {
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Never showed up',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!created.success) throw new Error(created.error.message);
    expect(await allocationsFor(created.data.id)).toHaveLength(1);

    const noShow = await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      status: 'no_show',
    });
    expect(noShow.success).toBe(true);

    expect(await allocationsFor(created.data.id)).toEqual([]);
    expect(await slotIsFree(world)).toBe(true);
  });

  it('completing an appointment also releases the holds — the room is free once it is over', async () => {
    // `completed` is not in `activeAppointmentStatuses` either, so it must free
    // the room on exactly the same terms. Easy to overlook because, unlike a
    // cancel, nothing about it feels like an "exit".
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Treatment finished',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!created.success) throw new Error(created.error.message);

    const completed = await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      status: 'completed',
    });
    expect(completed.success).toBe(true);
    expect(await allocationsFor(created.data.id)).toEqual([]);
  });

  it('soft-deleting the appointment releases the holds', async () => {
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'To be deleted',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!created.success) throw new Error(created.error.message);
    expect(await allocationsFor(created.data.id)).toHaveLength(1);

    const deleted = await deleteAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
    });
    expect(deleted.success).toBe(true);

    // A SOFT delete leaves the appointment row in place, so nothing cascades
    // and nothing else will ever come back for these holds.
    expect(await allocationsFor(created.data.id)).toEqual([]);
    expect(await slotIsFree(world)).toBe(true);
  });

  it('deposit expiry cancels the appointment AND releases the holds, in one transaction', async () => {
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Awaiting deposit',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
      status: 'held',
    });
    if (!created.success) throw new Error(created.error.message);
    // `held` is an ACTIVE status on purpose — a hold that did not block the
    // slot would let a second customer book over it.
    expect(await allocationsFor(created.data.id)).toHaveLength(1);
    expect(await slotIsFree(world)).toBe(false);

    const depositId = await seedDeposit({
      organizationId: world.organizationId,
      appointmentId: created.data.id,
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const expired = await expireAppointmentDeposit(db, { depositId });
    expect(expired.success).toBe(true);
    if (!expired.success) throw new Error(expired.error.message);
    expect(expired.data.expired).toBe(true);

    expect(await allocationsFor(created.data.id)).toEqual([]);
    expect(await slotIsFree(world)).toBe(true);
  });

  it('reschedule re-allocates: the old range is freed, the new one held, and it does not conflict with itself', async () => {
    // ONE room, and the new window OVERLAPS the old. If the release did not
    // happen before the re-take, the appointment would collide with its own
    // hold against `resource_no_overlap` — which `excludeAppointmentIds` cannot
    // prevent, because it filters the availability query, not the constraint.
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Moving by thirty minutes',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!created.success) throw new Error(created.error.message);

    const moved = await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      startDate: at('2026-06-01T10:30:00.000Z'),
      endDate: at('2026-06-01T11:30:00.000Z'),
    });
    expect(moved.success).toBe(true);
    if (!moved.success) throw new Error(moved.error.message);
    expect(moved.data.resourceWarnings).toEqual([]);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].startDate.toISOString()).toBe(
      at('2026-06-01T10:30:00.000Z').toISOString()
    );
    expect(holds[0].endDate.toISOString()).toBe(
      at('2026-06-01T11:30:00.000Z').toISOString()
    );

    // The vacated 10:00–10:30 sliver is genuinely free again.
    expect(
      await slotIsFree(
        world,
        at('2026-06-01T09:30:00.000Z'),
        at('2026-06-01T10:30:00.000Z')
      )
    ).toBe(true);
    // …and the new range is genuinely held.
    expect(
      await slotIsFree(
        world,
        at('2026-06-01T11:00:00.000Z'),
        at('2026-06-01T12:00:00.000Z')
      )
    ).toBe(false);
  });

  it('reschedule KEEPS a manually-chosen resource when it is still free at the new time', async () => {
    const world = await seedWorld(2);
    const [roomOne, roomTwo] = world.roomIds;

    // The front desk picked Room 2 deliberately — the auto-picker would have
    // taken Room 1 (lower sortOrder), so a silent re-pick is detectable.
    const created = await book(world, {
      title: 'Front desk chose Room 2',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
      resourceIds: [roomTwo],
    });
    if (!created.success) throw new Error(created.error.message);
    expect(await allocationsFor(created.data.id)).toEqual([
      expect.objectContaining({ resourceId: roomTwo, source: 'manual' }),
    ]);

    const moved = await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      startDate: at('2026-06-01T14:00:00.000Z'),
      endDate: at('2026-06-01T15:00:00.000Z'),
    });
    expect(moved.success).toBe(true);
    if (!moved.success) throw new Error(moved.error.message);
    expect(moved.data.resourceWarnings).toEqual([]);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    // Still the human's choice, still flagged as the human's choice.
    expect(holds[0].resourceId).toBe(roomTwo);
    expect(holds[0].source).toBe('manual');
    expect(holds[0].resourceId).not.toBe(roomOne);
  });

  it('reschedule SWAPS a manually-chosen resource that is no longer free, and warns naming the clash', async () => {
    const world = await seedWorld(2);
    const [roomOne, roomTwo] = world.roomIds;

    const mine = await book(world, {
      title: 'Front desk chose Room 2',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
      resourceIds: [roomTwo],
    });
    if (!mine.success) throw new Error(mine.error.message);

    // Somebody else takes Room 2 at 14:00 — also by hand, so the clash is real.
    const blocker = await book(world, {
      title: 'Room 2 is spoken for',
      startDate: at('2026-06-01T14:00:00.000Z'),
      endDate: at('2026-06-01T15:00:00.000Z'),
      resourceIds: [roomTwo],
    });
    if (!blocker.success) throw new Error(blocker.error.message);

    const moved = await updateAppointment(db, {
      id: mine.data.id,
      organizationId: world.organizationId,
      startDate: at('2026-06-01T14:00:00.000Z'),
      endDate: at('2026-06-01T15:00:00.000Z'),
    });
    expect(moved.success).toBe(true);
    if (!moved.success) throw new Error(moved.error.message);

    // The move succeeds — a console reschedule is never refused — but the front
    // desk is TOLD which choice was overridden and what it clashed with.
    expect(moved.data.resourceWarnings).toHaveLength(1);
    const [warning] = moved.data.resourceWarnings;
    expect(warning.resourceId).toBe(roomTwo);
    expect(warning.categoryId).toBe(world.categoryId);
    expect(warning.conflictingAppointmentTitle).toBe('Room 2 is spoken for');
    expect(warning.conflictStart?.toISOString()).toBe(
      at('2026-06-01T14:00:00.000Z').toISOString()
    );

    // …and it landed in the free room instead of holding nothing.
    const holds = await allocationsFor(mine.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(roomOne);
    // Swapped by the system, so no longer flagged as a human's choice.
    expect(holds[0].source).toBe('auto');

    // The blocker kept what it had.
    expect(await allocationsFor(blocker.data.id)).toEqual([
      expect.objectContaining({ resourceId: roomTwo }),
    ]);
  });

  it('THE SWEEP: after a mixed book/cancel/no-show/reschedule/delete/deposit-expiry run, zero allocations belong to a non-active appointment', async () => {
    // Six rooms so nothing in the sequence is forced into an overlap; the
    // subject here is the lifecycle, not contention.
    const world = await seedWorld(6);

    const survives = await book(world, {
      title: 'Stays booked',
      startDate: at('2026-06-01T09:00:00.000Z'),
      endDate: at('2026-06-01T10:00:00.000Z'),
    });
    const cancelled = await book(world, {
      title: 'Gets cancelled',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    const noShow = await book(world, {
      title: 'Gets marked no-show',
      startDate: at('2026-06-01T11:00:00.000Z'),
      endDate: at('2026-06-01T12:00:00.000Z'),
    });
    const deleted = await book(world, {
      title: 'Gets deleted',
      startDate: at('2026-06-01T12:00:00.000Z'),
      endDate: at('2026-06-01T13:00:00.000Z'),
    });
    const moved = await book(world, {
      title: 'Gets rescheduled twice',
      startDate: at('2026-06-01T13:00:00.000Z'),
      endDate: at('2026-06-01T14:00:00.000Z'),
    });
    const depositHold = await book(world, {
      title: 'Deposit expires',
      startDate: at('2026-06-01T15:00:00.000Z'),
      endDate: at('2026-06-01T16:00:00.000Z'),
      status: 'held',
    });

    for (const result of [
      survives,
      cancelled,
      noShow,
      deleted,
      moved,
      depositHold,
    ]) {
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
    }
    if (
      !survives.success ||
      !cancelled.success ||
      !noShow.success ||
      !deleted.success ||
      !moved.success ||
      !depositHold.success
    ) {
      throw new Error('setup failed');
    }

    // Six live appointments, six holds.
    expect(await allocationCount(world.organizationId)).toBe(6);

    await updateAppointment(db, {
      id: cancelled.data.id,
      organizationId: world.organizationId,
      status: 'cancelled',
    });
    await updateAppointment(db, {
      id: noShow.data.id,
      organizationId: world.organizationId,
      status: 'no_show',
    });
    await deleteAppointment(db, {
      id: deleted.data.id,
      organizationId: world.organizationId,
    });
    await updateAppointment(db, {
      id: moved.data.id,
      organizationId: world.organizationId,
      startDate: at('2026-06-01T17:00:00.000Z'),
      endDate: at('2026-06-01T18:00:00.000Z'),
    });
    await updateAppointment(db, {
      id: moved.data.id,
      organizationId: world.organizationId,
      startDate: at('2026-06-01T18:00:00.000Z'),
      endDate: at('2026-06-01T19:00:00.000Z'),
    });
    const depositId = await seedDeposit({
      organizationId: world.organizationId,
      appointmentId: depositHold.data.id,
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expireAppointmentDeposit(db, { depositId });

    // ── THE INVARIANT ──────────────────────────────────────────────────────
    expect(await orphanedAllocations(world.organizationId)).toEqual([]);

    // Stated the other way round, so a bug that deleted EVERYTHING could not
    // pass the line above: exactly the two still-active appointments hold a
    // room each, and the rescheduled one holds its LATEST window.
    expect(await allocationCount(world.organizationId)).toBe(2);
    expect(await allocationsFor(survives.data.id)).toHaveLength(1);
    const movedHolds = await allocationsFor(moved.data.id);
    expect(movedHolds).toHaveLength(1);
    expect(movedHolds[0].startDate.toISOString()).toBe(
      at('2026-06-01T18:00:00.000Z').toISOString()
    );
  });

  it('releasing is idempotent: a second cancel of an already-cancelled appointment is a no-op', async () => {
    // Several release call sites are retried queue jobs (deposit expiry, hold
    // expiry), so a double release must not throw or corrupt anything.
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Cancelled twice',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!created.success) throw new Error(created.error.message);

    for (let i = 0; i < 2; i += 1) {
      const cancelled = await updateAppointment(db, {
        id: created.data.id,
        organizationId: world.organizationId,
        status: 'cancelled',
      });
      expect(cancelled.success).toBe(true);
    }

    expect(await allocationsFor(created.data.id)).toEqual([]);
    expect(await orphanedAllocations(world.organizationId)).toEqual([]);
  });

  it('a cancelled appointment does not hold its room against a NEW booking of the same slot', async () => {
    // The end-to-end statement of the invariant: not "the row is gone" but
    // "the clinic can sell the time again".
    const world = await seedWorld(1);
    const first = await book(world, {
      title: 'Cancelled',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!first.success) throw new Error(first.error.message);
    const heldRoom = (await allocationsFor(first.data.id))[0].resourceId;

    await updateAppointment(db, {
      id: first.data.id,
      organizationId: world.organizationId,
      status: 'cancelled',
    });

    const second = await book(world, {
      title: 'Takes the freed room',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error.message);

    const holds = await allocationsFor(second.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(heldRoom);
    // The rebooking took the room WITHOUT an overlap opt-out — proof the old
    // hold was really gone rather than merely stepped over.
    expect(holds[0].allowOverlap).toBe(false);
  });

  it('re-activating a cancelled appointment takes a room back', async () => {
    // The reverse transition. Without it, an appointment restored from
    // cancelled would sit on the calendar holding nothing and the engine would
    // go on offering its room to everyone else.
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Cancelled then restored',
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:00:00.000Z'),
    });
    if (!created.success) throw new Error(created.error.message);

    await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      status: 'cancelled',
    });
    expect(await allocationsFor(created.data.id)).toEqual([]);

    const restored = await updateAppointment(db, {
      id: created.data.id,
      organizationId: world.organizationId,
      status: 'booked',
    });
    expect(restored.success).toBe(true);

    expect(await allocationsFor(created.data.id)).toHaveLength(1);
    expect(await slotIsFree(world)).toBe(false);
    expect(await orphanedAllocations(world.organizationId)).toEqual([]);
  });
});
