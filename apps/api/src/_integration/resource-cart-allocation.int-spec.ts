/**
 * Phase 7 §7e (part 3) — resource allocation for a MULTI-SERVICE cart.
 *
 * A Fresha-style cart is several services on ONE appointment row, and v1 books
 * ONE hold per required CATEGORY spanning the whole appointment — not one hold
 * per line. That single sentence is the source of every rule below, and each of
 * them is the kind that fails silently: a second hold on the same room would
 * collide with the first, a summed turnaround would hold a room for an hour it
 * does not need, and a mis-collapsed eligibility list quietly books a room one
 * of the cart's services cannot be performed in.
 *
 * `cart-booking.int-spec.ts` proves the cart itself (one appointment, N line
 * items, snapshots). `resource-allocation-lifecycle.int-spec.ts` proves the
 * lifecycle for a SINGLE-service booking. Neither crosses the two, which is
 * where the collapsing rules live. This file does.
 *
 * Behaviour locked here:
 *  - Two services that both need a Room take ONE hold, spanning the whole
 *    appointment — not one per line, and not one per service.
 *  - A cart needing a Room AND a Laser takes exactly one hold per category.
 *  - The cleanup tail is the MAX turnaround across the cart, never the sum and
 *    never the first line's. The tail extends the HOLD, never the appointment.
 *  - Eligibility across a cart is an INTERSECTION: the one room held has to
 *    satisfy every service in it. Two overlapping lists collapse to the room
 *    they share, even when a higher-priority room would otherwise win.
 *  - ⚠️  DISJOINT eligibility lists for the same category are UNSATISFIABLE to
 *    the gate but NOT to the console fallback, and the two disagree. Online is
 *    refused with `CONFLICT`; the console books a room that satisfies only ONE
 *    of the two services, with NO warning. Pinned below with the mechanism —
 *    the gate intersects the lists, the fallback unions them.
 *  - A cart where only ONE line has a requirement is still allocated, over the
 *    whole appointment rather than over that line's share of it.
 *  - Rescheduling a cart moves EVERY hold and leaves no orphan behind — the
 *    lifecycle invariant, asserted across multiple categories at once.
 */
import { appointmentResource, db } from '@borradh-workspace/database';
import {
  createAppointment,
  updateAppointment,
} from '@borradh-workspace/features/appointments';
import { eq } from 'drizzle-orm';
import { seedLead, seedOrganization, seedUser } from './harness.js';
import {
  allocationsFor,
  orphanedAllocations,
  seedEligibility,
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

const TEN = at('2026-07-01T10:00:00.000Z');
const FIFTEEN = at('2026-07-01T15:00:00.000Z');
const MINUTE = 60_000;

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

interface CartWorld {
  organizationId: string;
  assigneeId: string;
  otherAssigneeId: string;
  leadId: string;
}

async function seedCartWorld(): Promise<CartWorld> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const otherAssignee = await seedUser();
  const leadId = await seedLead({ organizationId });
  return {
    organizationId,
    assigneeId: assignee.id,
    otherAssigneeId: otherAssignee.id,
    leadId,
  };
}

interface CartLine {
  serviceId: string;
  name: string;
  durationMinutes: number;
}

/**
 * Book a cart. `endDate` is deliberately NOT supplied — the server derives it
 * from the summed line durations, which is what a real cart booking does, and
 * an allocation spanning "the whole appointment" is only meaningful against the
 * end the server itself computed.
 */
const bookCart = (
  world: CartWorld,
  input: {
    title: string;
    startDate: Date;
    lines: CartLine[];
    source?: 'booking_form';
    useOtherAssignee?: boolean;
  }
) =>
  createAppointment(db, {
    title: input.title,
    startDate: input.startDate,
    leadId: world.leadId,
    assignedToId: input.useOtherAssignee
      ? world.otherAssigneeId
      : world.assigneeId,
    organizationId: world.organizationId,
    source: input.source,
    services: input.lines.map((line, index) => ({
      serviceId: line.serviceId,
      name: line.name,
      durationMinutes: line.durationMinutes,
      sortOrder: index,
    })),
  });

/** Total allocation rows in the org, whichever appointment they belong to. */
async function orgAllocationCount(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: appointmentResource.id })
    .from(appointmentResource)
    .where(eq(appointmentResource.organizationId, organizationId));
  return rows.length;
}

/* ------------------------------------------------------------------ */

describe('Phase 7 §7e (part 3) — cart resource allocation', () => {
  it('two services that BOTH need a Room take ONE hold, spanning the whole appointment', async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const roomOne = await seedResource({
      organizationId,
      categoryId,
      name: 'Room 1',
      sortOrder: 0,
    });
    await seedResource({
      organizationId,
      categoryId,
      name: 'Room 2',
      sortOrder: 1,
    });

    const facial = await seedResourceService({
      organizationId,
      name: 'Facial',
      appointmentDuration: 30,
    });
    const peel = await seedResourceService({
      organizationId,
      name: 'Peel',
      appointmentDuration: 30,
    });
    for (const serviceId of [facial, peel]) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }

    const created = await bookCart(world, {
      title: 'Facial + Peel',
      startDate: TEN,
      lines: [
        { serviceId: facial, name: 'Facial', durationMinutes: 30 },
        { serviceId: peel, name: 'Peel', durationMinutes: 30 },
      ],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    // The client stays in ONE room for the whole visit: a second hold on the
    // same category would collide with the first against `resource_no_overlap`.
    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(roomOne);
    expect(holds[0].source).toBe('auto');

    // Spanning the WHOLE appointment (30 + 30 = 60 minutes), not one line's share.
    expect(holds[0].startDate.toISOString()).toBe(TEN.toISOString());
    expect(holds[0].endDate.getTime() - holds[0].startDate.getTime()).toBe(
      60 * MINUTE
    );
    expect(created.data.endDate.toISOString()).toBe(
      holds[0].endDate.toISOString()
    );
  });

  it('a cart needing a Room AND a Laser takes exactly one hold per category', async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
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

    const consult = await seedResourceService({
      organizationId,
      name: 'Consultation',
      appointmentDuration: 20,
    });
    const ipl = await seedResourceService({
      organizationId,
      name: 'IPL',
      appointmentDuration: 40,
    });
    await seedRequirement({
      organizationId,
      serviceId: consult,
      categoryId: roomsId,
    });
    await seedRequirement({
      organizationId,
      serviceId: ipl,
      categoryId: lasersId,
    });

    const created = await bookCart(world, {
      title: 'Consultation + IPL',
      startDate: TEN,
      lines: [
        { serviceId: consult, name: 'Consultation', durationMinutes: 20 },
        { serviceId: ipl, name: 'IPL', durationMinutes: 40 },
      ],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(2);
    expect(holds.map((hold) => hold.resourceId).sort()).toEqual(
      [room, laser].sort()
    );
    // Both span the whole 60-minute visit — the laser is held through the
    // consultation too, because v1 holds per category, not per line.
    for (const hold of holds) {
      expect(hold.startDate.toISOString()).toBe(TEN.toISOString());
      expect(hold.endDate.getTime() - hold.startDate.getTime()).toBe(
        60 * MINUTE
      );
    }
    expect(
      created.data.resources.map((entry) => entry.categoryId).sort()
    ).toEqual([roomsId, lasersId].sort());
  });

  it("the cart's turnaround is the MAX across its services — not the sum, not the first line's", async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    await seedResource({ organizationId, categoryId, name: 'Room 1' });

    // First line has the SMALL tail, so "the first line's value" and "the max"
    // are distinguishable, and 10 + 30 ≠ 30 so the sum is distinguishable too.
    const quick = await seedResourceService({
      organizationId,
      name: 'Quick trim',
      appointmentDuration: 30,
      turnaroundMinutes: 10,
    });
    const messy = await seedResourceService({
      organizationId,
      name: 'Colour',
      appointmentDuration: 30,
      turnaroundMinutes: 30,
    });
    for (const serviceId of [quick, messy]) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }

    const created = await bookCart(world, {
      title: 'Trim + Colour',
      startDate: TEN,
      lines: [
        { serviceId: quick, name: 'Quick trim', durationMinutes: 30 },
        { serviceId: messy, name: 'Colour', durationMinutes: 30 },
      ],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].turnaroundMinutes).toBe(30);

    // The tail extends the HOLD, never the appointment: 10:00–11:00 booked,
    // 10:00–11:30 held.
    const appointmentEnd = new Date(TEN.getTime() + 60 * MINUTE);
    expect(created.data.endDate.toISOString()).toBe(
      appointmentEnd.toISOString()
    );
    expect(holds[0].endDate.toISOString()).toBe(
      new Date(appointmentEnd.getTime() + 30 * MINUTE).toISOString()
    );
    // Not the sum (40) and not the first line's (10).
    expect(holds[0].endDate.getTime()).not.toBe(
      appointmentEnd.getTime() + 40 * MINUTE
    );
    expect(holds[0].endDate.getTime()).not.toBe(
      appointmentEnd.getTime() + 10 * MINUTE
    );
  });

  it('two services whose eligibility lists INTERSECT share the one room that satisfies both', async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const roomOne = await seedResource({
      organizationId,
      categoryId,
      name: 'Room 1',
      sortOrder: 0,
    });
    const roomTwo = await seedResource({
      organizationId,
      categoryId,
      name: 'Room 2',
      sortOrder: 1,
    });
    const roomThree = await seedResource({
      organizationId,
      categoryId,
      name: 'Room 3',
      sortOrder: 2,
    });

    const wax = await seedResourceService({
      organizationId,
      name: 'Wax',
      appointmentDuration: 30,
    });
    const massage = await seedResourceService({
      organizationId,
      name: 'Massage',
      appointmentDuration: 30,
    });
    for (const serviceId of [wax, massage]) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }
    // Wax runs in 1 or 2; Massage runs in 2 or 3. Only Room 2 can do both, and
    // it is NOT the lowest sortOrder — so an implementation that ignored the
    // intersection would visibly take Room 1.
    await seedEligibility({
      organizationId,
      serviceId: wax,
      resourceId: roomOne,
    });
    await seedEligibility({
      organizationId,
      serviceId: wax,
      resourceId: roomTwo,
    });
    await seedEligibility({
      organizationId,
      serviceId: massage,
      resourceId: roomTwo,
    });
    await seedEligibility({
      organizationId,
      serviceId: massage,
      resourceId: roomThree,
    });

    const created = await bookCart(world, {
      title: 'Wax + Massage',
      startDate: TEN,
      lines: [
        { serviceId: wax, name: 'Wax', durationMinutes: 30 },
        { serviceId: massage, name: 'Massage', durationMinutes: 30 },
      ],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(roomTwo);
    expect(holds[0].resourceId).not.toBe(roomOne);
    expect(holds[0].resourceId).not.toBe(roomThree);
  });

  /**
   * DISJOINT eligibility across a cart is UNSATISFIABLE, on both paths.
   *
   * Two services on one appointment both need a Room; one may only run in the
   * laser room, the other only in the wet room. v1 holds ONE resource per
   * category for the whole appointment, so there is no room that does both and
   * the cart cannot be performed as booked.
   *
   * The online gate always got this right — `categoryDemands` INTERSECTS the
   * services' eligibility lists, so the intersection is empty and the slot is
   * never offered. The console's `diagnoseCategories` flattened every row into
   * one set, which reads as a UNION ("laser room OR wet room"), found one of
   * them free, and booked it with no warning at all. Which one it picked was
   * not even stable: candidates sorted by UUID.
   *
   * Both now intersect. Online is refused outright; the console keeps its
   * warn-don't-block contract — the booking goes through holding NOTHING, and
   * the front desk is TOLD. That is the improvement: it used to hold one of
   * the two rooms and say nothing, so the diary claimed a room that could not
   * perform half the cart, and the other service's room read as free.
   *
   * Holding nothing and warning is the honest version. The appointment cannot
   * be performed as booked, and the person who can fix it (drop a line, split
   * the appointment, use two rooms) is the one now looking at the warning.
   */
  it('DISJOINT eligibility: online is refused, the console books nothing and warns', async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const laserRoom = await seedResource({
      organizationId,
      categoryId,
      name: 'Laser room',
      sortOrder: 0,
    });
    const wetRoom = await seedResource({
      organizationId,
      categoryId,
      name: 'Wet room',
      sortOrder: 1,
    });

    const ipl = await seedResourceService({
      organizationId,
      name: 'IPL',
      appointmentDuration: 30,
    });
    const hydro = await seedResourceService({
      organizationId,
      name: 'Hydrotherapy',
      appointmentDuration: 30,
    });
    for (const serviceId of [ipl, hydro]) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }
    await seedEligibility({
      organizationId,
      serviceId: ipl,
      resourceId: laserRoom,
    });
    await seedEligibility({
      organizationId,
      serviceId: hydro,
      resourceId: wetRoom,
    });

    const lines = [
      { serviceId: ipl, name: 'IPL', durationMinutes: 30 },
      { serviceId: hydro, name: 'Hydrotherapy', durationMinutes: 30 },
    ];

    // ── ONLINE: refused, and the appointment row is rolled back. ────────────
    const online = await bookCart(world, {
      title: 'Online impossible cart',
      startDate: TEN,
      lines,
      source: 'booking_form',
    });
    expect(online.success).toBe(false);
    if (online.success) throw new Error('expected the online cart to block');
    expect(online.error.code).toBe('CONFLICT');
    expect(online.error.message).toContain('Rooms');
    expect(await orgAllocationCount(organizationId)).toBe(0);

    // ── CONSOLE: booked, holding NOTHING, and warned about. ────────────────
    const fromConsole = await bookCart(world, {
      title: 'Console impossible cart',
      startDate: TEN,
      lines,
      useOtherAssignee: true,
    });
    expect(fromConsole.success).toBe(true);
    if (!fromConsole.success) throw new Error(fromConsole.error.message);

    // The critical half: NO room was taken. Taking one would put a booking in
    // a room that cannot perform half its cart, and would show the OTHER
    // service's room as free when it is the only one that could do the job.
    expect(await allocationsFor(fromConsole.data.id)).toEqual([]);
    expect(await orgAllocationCount(organizationId)).toBe(0);

    // And the front desk is told which category could not be filled — the
    // shape that carries a null resource, because there is nothing to name.
    expect(fromConsole.data.resourceWarnings).toHaveLength(1);
    const [warning] = fromConsole.data.resourceWarnings;
    expect(warning.categoryName).toBe('Rooms');
    expect(warning.resourceId).toBeNull();
    expect([laserRoom, wetRoom]).toHaveLength(2);
  });

  it('a cart where only ONE service has a requirement is still allocated, over the whole appointment', async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const room = await seedResource({
      organizationId,
      categoryId,
      name: 'Room 1',
    });

    const gated = await seedResourceService({
      organizationId,
      name: 'Microneedling',
      appointmentDuration: 45,
      turnaroundMinutes: 15,
    });
    const ungated = await seedResourceService({
      organizationId,
      name: 'Patch test',
      appointmentDuration: 15,
    });
    await seedRequirement({ organizationId, serviceId: gated, categoryId });

    const created = await bookCart(world, {
      title: 'Patch test + Microneedling',
      startDate: TEN,
      lines: [
        // The UNGATED line first, so a naive "read the requirement off the
        // primary service" would find nothing and hold nothing.
        { serviceId: ungated, name: 'Patch test', durationMinutes: 15 },
        { serviceId: gated, name: 'Microneedling', durationMinutes: 45 },
      ],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(room);
    // Held for the whole 60-minute visit plus the gated line's 15-minute tail,
    // not merely for its own 45-minute share.
    expect(holds[0].startDate.toISOString()).toBe(TEN.toISOString());
    expect(holds[0].turnaroundMinutes).toBe(15);
    expect(holds[0].endDate.toISOString()).toBe(
      new Date(TEN.getTime() + 75 * MINUTE).toISOString()
    );
  });

  it('rescheduling a cart booking moves EVERY hold and leaves no orphan behind', async () => {
    const world = await seedCartWorld();
    const { organizationId } = world;
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

    const consult = await seedResourceService({
      organizationId,
      name: 'Consultation',
      appointmentDuration: 30,
    });
    const ipl = await seedResourceService({
      organizationId,
      name: 'IPL',
      appointmentDuration: 30,
      turnaroundMinutes: 20,
    });
    await seedRequirement({
      organizationId,
      serviceId: consult,
      categoryId: roomsId,
    });
    await seedRequirement({
      organizationId,
      serviceId: ipl,
      categoryId: lasersId,
    });

    const created = await bookCart(world, {
      title: 'Cart to be moved',
      startDate: TEN,
      lines: [
        { serviceId: consult, name: 'Consultation', durationMinutes: 30 },
        { serviceId: ipl, name: 'IPL', durationMinutes: 30 },
      ],
    });
    if (!created.success) throw new Error(created.error.message);
    expect(await allocationsFor(created.data.id)).toHaveLength(2);

    const newEnd = new Date(FIFTEEN.getTime() + 60 * MINUTE);
    const moved = await updateAppointment(db, {
      id: created.data.id,
      organizationId,
      startDate: FIFTEEN,
      endDate: newEnd,
    });
    expect(moved.success).toBe(true);
    if (!moved.success) throw new Error(moved.error.message);
    expect(moved.data.resourceWarnings).toEqual([]);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(2);
    expect(holds.map((hold) => hold.resourceId).sort()).toEqual(
      [room, laser].sort()
    );
    for (const hold of holds) {
      expect(hold.startDate.toISOString()).toBe(FIFTEEN.toISOString());
      // The cart's max turnaround (20) still tails every hold at the new time.
      expect(hold.turnaroundMinutes).toBe(20);
      expect(hold.endDate.toISOString()).toBe(
        new Date(newEnd.getTime() + 20 * MINUTE).toISOString()
      );
    }

    // Exactly two rows exist in the whole org: the old pair was RELEASED, not
    // orphaned alongside the new one.
    expect(await orgAllocationCount(organizationId)).toBe(2);
    expect(await orphanedAllocations(organizationId)).toEqual([]);
  });
});
