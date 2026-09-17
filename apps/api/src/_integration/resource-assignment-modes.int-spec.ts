/**
 * Phase 7 §7e — assignment modes: auto vs manual, warn vs block.
 *
 * Two independent axes decide what happens when a booking meets a resource
 * requirement, and confusing them is the easiest way to build either a useless
 * console or an ungated booking widget:
 *
 *   WHO PICKS        `org_defaults.resource_assignment_mode` — auto, or the
 *                    front desk. Applies to CONSOLE bookings only.
 *   WHAT ON FAILURE  the booking's own source. ONLINE (`source !== 'manual'`)
 *                    is a hard block: a customer must never be handed a slot the
 *                    clinic cannot physically run. CONSOLE warns and books
 *                    anyway — staff already double-book practitioners and book
 *                    outside posted hours, and taking that away for rooms would
 *                    make the console worse than the paper diary it replaced.
 *
 * Behaviour locked here:
 *  - `auto` writes `source = 'auto'`, breaks ties on the clinic's own
 *    `sortOrder` deterministically, and prefers the less-loaded resource when
 *    the competing hold is visible in the availability window.
 *  - ⚠️  A KNOWN DEFECT is pinned here too: the least-allocated-that-day
 *    heuristic cannot see a hold EARLIER in the same day, because the day
 *    bucket it counts over is wider than the window the busy set is loaded
 *    for. See `KNOWN GAP:` below for the mechanism and the fix location.
 *  - `manual` mode + CONSOLE booking creates NO allocation: the front desk
 *    assigns later, and the appointment reads back as still needing a room.
 *  - `manual` mode + ONLINE booking STILL auto-assigns. A client cannot pick a
 *    room, so honouring manual mode there would leave every online slot
 *    ungated — the exact hole this feature exists to close. The setting
 *    controls who picks, never whether gating happens: an online booking with
 *    nothing free is still refused while the org is on `manual`.
 *  - ONLINE with no free resource ⇒ `CONFLICT`, and the appointment row is
 *    ROLLED BACK. A customer told "that time isn't available" who then finds a
 *    confirmation in their inbox is worse than either outcome alone.
 *  - CONSOLE with no free resource ⇒ the appointment IS created, carries a
 *    `resourceWarnings[]` entry naming the room and the booking it clashes
 *    with, and the allocation carries `allow_overlap = true` so it can coexist
 *    with the hold it is overriding.
 *  - Explicit `resourceIds` outrank the org's mode entirely and are stored as
 *    `source = 'manual'`; a category the operator did not name is still filled,
 *    or the engine would go on offering a laser this appointment is using.
 *  - An explicit id from another org, from a category no service requires, from
 *    a deactivated resource, or two from the same category ⇒ `VALIDATION_ERROR`
 *    and no appointment. Never silently dropped: a dropped id means the booking
 *    quietly gets a different room than the operator chose.
 */
import { appointment, db, orgDefaults } from '@borradh-workspace/database';
import { createAppointment } from '@borradh-workspace/features/appointments';
import {
  getServiceResourceRequirements,
  listAppointmentResources,
} from '@borradh-workspace/features/resources';
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

interface World {
  organizationId: string;
  assigneeId: string;
  /** A second assignee, so two same-time bookings do not clash on the ASSIGNEE. */
  otherAssigneeId: string;
  leadId: string;
  serviceId: string;
  categoryId: string;
  /** Room ids in `sortOrder` order. */
  roomIds: string[];
}

async function seedWorld(
  roomCount = 1,
  opts: {
    assignmentMode?: 'auto' | 'manual';
    capacity?: number;
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
        capacity: opts.capacity ?? 1,
      })
    );
  }

  await seedRequirement({ organizationId, serviceId, categoryId });

  if (opts.assignmentMode) {
    await db
      .insert(orgDefaults)
      .values({ organizationId, resourceAssignmentMode: opts.assignmentMode });
  }

  return {
    organizationId,
    assigneeId: assignee.id,
    otherAssigneeId: otherAssignee.id,
    leadId,
    serviceId,
    categoryId,
    roomIds,
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
    serviceId: world.serviceId,
    resourceIds: input.resourceIds,
    source: input.source,
  });

/** Does an appointment with this title exist (i.e. did a refusal roll back)? */
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

const HOUR = {
  nine: {
    startDate: at('2026-07-01T09:00:00.000Z'),
    endDate: at('2026-07-01T10:00:00.000Z'),
  },
  eleven: {
    startDate: at('2026-07-01T11:00:00.000Z'),
    endDate: at('2026-07-01T12:00:00.000Z'),
  },
  thirteen: {
    startDate: at('2026-07-01T13:00:00.000Z'),
    endDate: at('2026-07-01T14:00:00.000Z'),
  },
  fourteen: {
    startDate: at('2026-07-01T14:00:00.000Z'),
    endDate: at('2026-07-01T15:00:00.000Z'),
  },
};

describe('Phase 7 §7e — assignment modes', () => {
  it('auto mode records the allocation as source = auto', async () => {
    const world = await seedWorld(1);
    const created = await book(world, {
      title: 'Auto-assigned',
      ...HOUR.fourteen,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    expect(created.data.resources).toEqual([
      { categoryId: world.categoryId, resourceId: world.roomIds[0] },
    ]);
    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].source).toBe('auto');
    // Capacity 1 and genuinely free, so no overlap opt-out is warranted — the
    // exclusion constraint is left to police this row.
    expect(holds[0].allowOverlap).toBe(false);
  });

  it("auto breaks a tie on the clinic's own sortOrder, deterministically", async () => {
    const world = await seedWorld(2);
    const [roomOne, roomTwo] = world.roomIds;

    // Both idle ⇒ equal load ⇒ the order the clinic itself chose decides. The
    // strict `<` in the picker keeps the first winner, so a given clinic state
    // always allocates the same room — re-running a booking flow can never
    // shuffle which room the calendar shows.
    const first = await book(world, { title: 'First', ...HOUR.nine });
    if (!first.success) throw new Error(first.error.message);
    expect((await allocationsFor(first.data.id))[0].resourceId).toBe(roomOne);

    const second = await book(world, {
      title: 'Second, different day-part',
      ...HOUR.thirteen,
    });
    if (!second.success) throw new Error(second.error.message);
    expect([roomOne, roomTwo]).toContain(
      (await allocationsFor(second.data.id))[0].resourceId
    );
  });

  it('auto prefers the less-loaded room when the competing hold is inside the availability window', async () => {
    const world = await seedWorld(2);
    const [roomOne, roomTwo] = world.roomIds;

    // 13:00 goes to Room 1 on the tie-break.
    const afternoon = await book(world, {
      title: 'Afternoon',
      ...HOUR.thirteen,
    });
    if (!afternoon.success) throw new Error(afternoon.error.message);
    expect((await allocationsFor(afternoon.data.id))[0].resourceId).toBe(
      roomOne
    );

    // Now book 11:00. Room 1 is FREE at 11:00 — nothing overlaps — but it
    // already carries a hold later in the window, so the spread rule must send
    // this one to Room 2. This is the assertion that the heuristic is a real
    // load comparison and not just "always take the first free room".
    const late = await book(world, { title: 'Late morning', ...HOUR.eleven });
    if (!late.success) throw new Error(late.error.message);
    expect((await allocationsFor(late.data.id))[0].resourceId).toBe(roomTwo);
  });

  /**
   * THE SPREAD HEURISTIC, in the direction that used to be blind.
   *
   * `pickResourcesFor` breaks ties between free rooms by how many holds each
   * already has that day. It counts from `ctx.availabilityByResource[].busy`,
   * and that context used to be loaded over the SLOT ONLY:
   *
   *     from: startDate,
   *     to:   endDate + MAX_TURNAROUND_MINUTES
   *
   * so nothing before the slot's own start could ever be in `busy`. For a
   * clinic booking its day in chronological order — i.e. every clinic — load
   * was 0 for every candidate on every booking, the comparison always tied,
   * and everything piled into the lowest-`sortOrder` room. Room 1 full, Room 2
   * empty, all day.
   *
   * The context is now loaded over the whole UTC day, which is the same bucket
   * the count uses. Widening cannot change WHETHER a room is free — every
   * freeness check is an overlap test against the slot — so the only thing it
   * alters is this tie-break.
   */
  it('spreads a later booking into the room that is still empty today', async () => {
    const world = await seedWorld(2);
    const [roomOne, roomTwo] = world.roomIds;

    const morning = await book(world, { title: 'Morning', ...HOUR.nine });
    if (!morning.success) throw new Error(morning.error.message);
    expect((await allocationsFor(morning.data.id))[0].resourceId).toBe(roomOne);

    // Room 1 already has a booking today and Room 2 does not, so 11:00 goes to
    // Room 2 — even though both are free at 11:00 and Room 1 sorts first.
    const later = await book(world, { title: 'Later', ...HOUR.eleven });
    if (!later.success) throw new Error(later.error.message);
    expect((await allocationsFor(later.data.id))[0].resourceId).toBe(roomTwo);
  });

  it('manual mode + CONSOLE booking creates no allocation, and the appointment reads back as needing a room', async () => {
    const world = await seedWorld(2, { assignmentMode: 'manual' });

    const created = await book(world, {
      title: 'Front desk will assign later',
      ...HOUR.fourteen,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    expect(created.data.resources).toEqual([]);
    expect(created.data.resourceWarnings).toEqual([]);
    expect(await allocationsFor(created.data.id)).toEqual([]);

    // "Needs a room" is not an absence of information — the requirement is
    // still on the service, so the UI can say which category is outstanding.
    const requirements = await getServiceResourceRequirements(db, {
      organizationId: world.organizationId,
      serviceId: world.serviceId,
    });
    expect(requirements.success).toBe(true);
    if (!requirements.success) throw new Error(requirements.error.message);
    expect(requirements.data.requirements.map((row) => row.categoryId)).toEqual(
      [world.categoryId]
    );

    // …and the rooms calendar shows nothing held for that window.
    const allocations = await listAppointmentResources(db, {
      organizationId: world.organizationId,
      from: at('2026-07-01T00:00:00.000Z'),
      to: at('2026-07-02T00:00:00.000Z'),
    });
    expect(allocations.success).toBe(true);
    if (!allocations.success) throw new Error(allocations.error.message);
    expect(allocations.data).toEqual([]);
  });

  it('manual mode + ONLINE booking is STILL auto-assigned — a client cannot pick a room', async () => {
    const world = await seedWorld(1, { assignmentMode: 'manual' });

    const created = await book(world, {
      title: 'Online booking under manual mode',
      ...HOUR.fourteen,
      source: 'booking_form',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    expect(created.data.resources).toEqual([
      { categoryId: world.categoryId, resourceId: world.roomIds[0] },
    ]);
    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].source).toBe('auto');
  });

  it('manual mode does not disable GATING: an online booking with nothing free is still refused', async () => {
    // The setting controls WHO picks. If it also controlled WHETHER gating
    // happens, every online slot on a `manual` org would be ungated — the hole
    // this whole feature exists to close.
    const world = await seedWorld(1, { assignmentMode: 'manual' });

    const consoleBooking = await book(world, {
      title: 'Console booking takes the room',
      ...HOUR.fourteen,
      resourceIds: [world.roomIds[0]],
    });
    expect(consoleBooking.success).toBe(true);

    const online = await book(world, {
      title: 'Online must be refused',
      ...HOUR.fourteen,
      source: 'booking_form',
      useOtherAssignee: true,
    });
    expect(online.success).toBe(false);
    if (online.success) throw new Error('expected the online booking to block');
    expect(online.error.code).toBe('CONFLICT');
    expect(
      await appointmentExists(world.organizationId, 'Online must be refused')
    ).toBe(false);
  });

  it('ONLINE with no free resource: CONFLICT, and the appointment is rolled back', async () => {
    const world = await seedWorld(1);

    const first = await book(world, {
      title: 'Takes the only room',
      ...HOUR.fourteen,
      source: 'booking_form',
    });
    expect(first.success).toBe(true);

    const second = await book(world, {
      title: 'Refused — no room',
      ...HOUR.fourteen,
      source: 'booking_form',
      useOtherAssignee: true,
    });
    expect(second.success).toBe(false);
    if (second.success) throw new Error('expected a refusal');
    expect(second.error.code).toBe('CONFLICT');
    // The message names the category in the CLINIC's own vocabulary.
    expect(second.error.message).toContain('Rooms');

    expect(
      await appointmentExists(world.organizationId, 'Refused — no room')
    ).toBe(false);
    // …and nothing extra was held on the way out.
    const allocations = await listAppointmentResources(db, {
      organizationId: world.organizationId,
      from: at('2026-07-01T00:00:00.000Z'),
      to: at('2026-07-02T00:00:00.000Z'),
    });
    if (!allocations.success) throw new Error(allocations.error.message);
    expect(allocations.data).toHaveLength(1);
  });

  it('CONSOLE with no free resource: the appointment IS created, warned about, and the hold opts out of the exclusion constraint', async () => {
    const world = await seedWorld(1);

    const first = await book(world, {
      title: 'Existing booking',
      ...HOUR.fourteen,
    });
    expect(first.success).toBe(true);

    const second = await book(world, {
      title: 'Squeezed in by the front desk',
      ...HOUR.fourteen,
      useOtherAssignee: true,
    });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error.message);

    // Booked anyway…
    expect(
      await appointmentExists(
        world.organizationId,
        'Squeezed in by the front desk'
      )
    ).toBe(true);

    // …with the front desk told exactly what it is stepping on.
    expect(second.data.resourceWarnings).toHaveLength(1);
    const [warning] = second.data.resourceWarnings;
    expect(warning.categoryId).toBe(world.categoryId);
    expect(warning.categoryName).toBe('Rooms');
    expect(warning.resourceId).toBe(world.roomIds[0]);
    expect(warning.conflictingAppointmentTitle).toBe('Existing booking');
    expect(warning.conflictStart?.toISOString()).toBe(
      HOUR.fourteen.startDate.toISOString()
    );

    // The override row exists ONLY because it opted out of
    // `resource_no_overlap` — without the flag the INSERT could not have landed.
    const holds = await allocationsFor(second.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(world.roomIds[0]);
    expect(holds[0].allowOverlap).toBe(true);
  });

  it('CONSOLE with a required category that has no resources at all: warned with nothing to name', async () => {
    const world = await seedWorld(0); // requirement exists; category is empty

    const created = await book(world, {
      title: 'Nothing to assign',
      ...HOUR.fourteen,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    expect(created.data.resources).toEqual([]);
    expect(created.data.resourceWarnings).toHaveLength(1);
    const [warning] = created.data.resourceWarnings;
    expect(warning.categoryName).toBe('Rooms');
    // Nullable precisely for this case — there is no room to name, but the
    // front desk still has to learn this appointment has none.
    expect(warning.resourceId).toBeNull();
    expect(warning.resourceName).toBeNull();
  });

  it('explicit resourceIds are honoured verbatim and stored as source = manual', async () => {
    const world = await seedWorld(3);
    const [, , roomThree] = world.roomIds;

    // Room 3 has the HIGHEST sortOrder, so the auto-picker would never choose
    // it here — a silent re-pick would be visible.
    const created = await book(world, {
      title: 'Operator insisted on Room 3',
      ...HOUR.fourteen,
      resourceIds: [roomThree],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    expect(created.data.resources).toEqual([
      { categoryId: world.categoryId, resourceId: roomThree },
    ]);
    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(roomThree);
    expect(holds[0].source).toBe('manual');
  });

  it('explicit resourceIds outrank manual mode: naming a room under manual mode still allocates it', async () => {
    const world = await seedWorld(2, { assignmentMode: 'manual' });

    const created = await book(world, {
      title: 'Front desk assigned it now, not later',
      ...HOUR.fourteen,
      resourceIds: [world.roomIds[1]],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(world.roomIds[1]);
    expect(holds[0].source).toBe('manual');
  });

  it('a category the operator did NOT name is still filled — an unheld requirement is a silent gating hole', async () => {
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const serviceId = await seedResourceService({
      organizationId,
      appointmentDuration: 60,
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
    for (const categoryId of [roomsId, lasersId]) {
      await seedRequirement({ organizationId, serviceId, categoryId });
    }

    // Only the room is named; the laser must still be held, or the engine goes
    // on offering it to everyone else while this appointment is using it.
    const created = await createAppointment(db, {
      title: 'Named the room, not the laser',
      startDate: HOUR.fourteen.startDate,
      endDate: HOUR.fourteen.endDate,
      leadId,
      assignedToId: assignee.id,
      organizationId,
      serviceId,
      resourceIds: [room],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(2);
    const byResource = new Map(holds.map((hold) => [hold.resourceId, hold]));
    expect(byResource.get(room)?.source).toBe('manual');
    expect(byResource.get(laser)?.source).toBe('auto');
  });

  it("explicit resourceIds naming ANOTHER ORG's resource ⇒ VALIDATION_ERROR, no appointment", async () => {
    const world = await seedWorld(1);
    const otherOrg = await seedOrganization();
    const otherCategory = await seedResourceCategory({
      organizationId: otherOrg,
      name: 'Rooms',
    });
    const foreignRoom = await seedResource({
      organizationId: otherOrg,
      categoryId: otherCategory,
      name: 'Not our room',
    });

    const created = await book(world, {
      title: 'Foreign room',
      ...HOUR.fourteen,
      resourceIds: [foreignRoom],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(await appointmentExists(world.organizationId, 'Foreign room')).toBe(
      false
    );
  });

  it('explicit resourceIds naming a category no service requires is HONOURED, and the real requirement is still filled', async () => {
    const world = await seedWorld(1);
    // A real resource in this org, in a category the booked service does not
    // require. Requirements decide what is GATED, not what staff may record —
    // a front desk putting a facial in a treatment room the service does not
    // demand is an ordinary thing to do, and refusing it made the booking
    // dialog's optional pickers unusable.
    const otherCategory = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Storage cupboards',
    });
    const cupboard = await seedResource({
      organizationId: world.organizationId,
      categoryId: otherCategory,
      name: 'Cupboard 1',
    });

    const created = await book(world, {
      title: 'Wrong category',
      ...HOUR.fourteen,
      resourceIds: [cupboard],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('expected the booking to succeed');

    const held = await allocationsFor(created.data.id);
    const heldIds = held.map((row) => row.resourceId).sort();

    // BOTH: the named cupboard, AND the room the service actually requires.
    // Honouring the operator's pick must never leave the requirement unfilled
    // — that would be a silent gating hole, with the engine going on offering
    // a room this appointment is really using.
    expect(heldIds).toHaveLength(2);
    expect(heldIds).toContain(cupboard);

    // The cupboard carries no turnaround: cleanup time belongs to the
    // REQUIREMENT, not to any room the operator happens to add.
    const cupboardHold = held.find((row) => row.resourceId === cupboard);
    expect(cupboardHold?.turnaroundMinutes).toBe(0);
  });

  it('explicit resourceIds naming a DEACTIVATED resource ⇒ VALIDATION_ERROR, never a silent substitution', async () => {
    const world = await seedWorld(1);
    const retired = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      name: 'Retired room',
      isActive: false,
      sortOrder: 9,
    });

    const created = await book(world, {
      title: 'Deactivated room',
      ...HOUR.fourteen,
      resourceIds: [retired],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    // The live room must NOT have been quietly substituted.
    expect(
      await appointmentExists(world.organizationId, 'Deactivated room')
    ).toBe(false);
  });

  it('two explicit resources from the SAME category ⇒ VALIDATION_ERROR (v1 holds one per category)', async () => {
    const world = await seedWorld(2);

    const created = await book(world, {
      title: 'Two rooms at once',
      ...HOUR.fourteen,
      resourceIds: world.roomIds,
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(
      await appointmentExists(world.organizationId, 'Two rooms at once')
    ).toBe(false);
  });

  it('an explicitly-named room that is genuinely busy loses to the DB constraint and reads as CONFLICT, not a 500', async () => {
    // `allocateExplicit` deliberately does NOT set `allowOverlap` for a
    // capacity-1 resource: forcing a known clash is the reassign endpoint's job,
    // behind its own explicit flag. So the INSERT hits `resource_no_overlap`,
    // and that must surface as "someone just took it" rather than an
    // INTERNAL_ERROR.
    const world = await seedWorld(2);
    const [roomOne] = world.roomIds;

    const first = await book(world, {
      title: 'Holds Room 1',
      ...HOUR.fourteen,
      resourceIds: [roomOne],
    });
    expect(first.success).toBe(true);

    const second = await book(world, {
      title: 'Insists on the busy Room 1',
      ...HOUR.fourteen,
      resourceIds: [roomOne],
      useOtherAssignee: true,
    });
    expect(second.success).toBe(false);
    if (second.success) throw new Error('expected the clash to be refused');
    expect(second.error.code).toBe('CONFLICT');
    expect(
      await appointmentExists(
        world.organizationId,
        'Insists on the busy Room 1'
      )
    ).toBe(false);
  });
});
