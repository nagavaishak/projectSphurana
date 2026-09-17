/**
 * Re-allocation must stay inside the appointment's own branch.
 *
 * `reallocateAppointmentResources` takes an appointment id and nothing else —
 * it is the shared path behind updating an appointment, rescheduling a managed
 * one, and restoring a lead hold. All three call it with `{ appointmentId,
 * organizationId }`, so before this fix none of them supplied a branch and the
 * allocator drew from every room the ORGANISATION owns.
 *
 * The result is not a visible error. A Dublin booking is quietly handed a Cork
 * room: Dublin's staff see a booking holding a room that is not in the
 * building, Cork's rooms calendar shows a room occupied by a booking nobody
 * there made, and the gating engine goes on refusing that Cork room to actual
 * Cork bookings. Nothing throws, and nothing self-heals.
 *
 * The branch is read from the appointment ROW rather than passed in, because
 * the row is the only caller-independent source of it. That also means the
 * fix covers all three callers at once.
 *
 * A resource with a NULL location is deliberately still eligible — null means
 * "available at every branch" (the trolley-mounted device), not "available at
 * none. Asserting that is half the point: a fix that scoped with a bare
 * equality would pass the first test here and fail the second.
 */
import { appointmentResource, db } from '@borradh-workspace/database';
import { reallocateAppointmentResources } from '@borradh-workspace/features/appointments';
import { eq } from 'drizzle-orm';
import {
  seedAppointment,
  seedLocation,
  seedOrganization,
  seedUser,
} from './harness.js';
import {
  seedAllocation,
  seedEligibility,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

const START = (() => {
  const d = new Date();
  d.setUTCHours(10, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 14);
  return d;
})();
const END = new Date(START.getTime() + 60 * 60 * 1000);

interface World {
  organizationId: string;
  assigneeId: string;
  serviceId: string;
  dublinId: string;
  corkId: string;
}

/**
 * An org with two branches and one service that requires one room. Rooms are
 * added per-test so each case controls exactly which branches have one.
 */
async function seedTwoBranchOrg(): Promise<World & { categoryId: string }> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const dublinId = await seedLocation({
    organizationId,
    name: 'Dublin',
    isPrimary: true,
  });
  const corkId = await seedLocation({
    organizationId,
    name: 'Cork',
    isPrimary: false,
  });
  const categoryId = await seedResourceCategory({ organizationId });
  const serviceId = await seedResourceService({
    organizationId,
    appointmentDuration: 60,
  });
  await seedRequirement({ organizationId, serviceId, categoryId });

  return {
    organizationId,
    assigneeId: assignee.id,
    serviceId,
    dublinId,
    corkId,
    categoryId,
  };
}

const allocatedResourceIds = async (appointmentId: string) =>
  (
    await db
      .select({ resourceId: appointmentResource.resourceId })
      .from(appointmentResource)
      .where(eq(appointmentResource.appointmentId, appointmentId))
  ).map((row) => row.resourceId);

describe('reallocateAppointmentResources — the appointment stays in its branch', () => {
  it('never hands a Dublin booking a Cork room', async () => {
    const world = await seedTwoBranchOrg();

    // Cork's room sorts FIRST, so an unscoped auto-picker reaches for it before
    // Dublin's. Without the branch filter this test picks Cork every time.
    const corkRoom = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      locationId: world.corkId,
      name: 'Cork Room 1',
      sortOrder: 0,
    });
    const dublinRoom = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      locationId: world.dublinId,
      name: 'Dublin Room 1',
      sortOrder: 1,
    });
    for (const resourceId of [corkRoom, dublinRoom]) {
      await seedEligibility({
        organizationId: world.organizationId,
        serviceId: world.serviceId,
        resourceId,
      });
    }

    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: world.assigneeId,
      serviceId: world.serviceId,
      startDate: START,
      endDate: END,
      locationId: world.dublinId,
    });

    await reallocateAppointmentResources(db, {
      appointmentId,
      organizationId: world.organizationId,
    });

    expect(await allocatedResourceIds(appointmentId)).toEqual([dublinRoom]);
  });

  it('releases a MANUAL pick whose room has since moved to another branch', async () => {
    // §5c. Reachable through two ordinary actions, neither of which touches the
    // appointment:
    //
    //   1. the front desk manually picks Room 3 for a Dublin booking;
    //   2. someone later edits Room 3 and moves it to Cork
    //      (`updateResource` takes `locationId`).
    //
    // The next reschedule ran the retention loop, which only asked "is it
    // busy?", and kept it — a Dublin appointment holding a Cork room. The AUTO
    // allocation has been branch-filtered since `cab7e9961`; this path ran
    // ahead of it and was not.
    const world = await seedTwoBranchOrg();

    const movedRoom = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      // Already at Cork — the state AFTER the move. Seeding the end state
      // rather than calling updateResource keeps this a test of the allocator.
      locationId: world.corkId,
      name: 'Room 3 (moved to Cork)',
      sortOrder: 0,
    });
    const dublinRoom = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      locationId: world.dublinId,
      name: 'Dublin Room 1',
      sortOrder: 1,
    });

    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: world.assigneeId,
      serviceId: world.serviceId,
      startDate: START,
      endDate: END,
      locationId: world.dublinId,
    });

    // The human's pick, recorded before the room moved.
    await seedAllocation({
      organizationId: world.organizationId,
      appointmentId,
      resourceId: movedRoom,
      startDate: START,
      endDate: END,
      source: 'manual',
    });

    await reallocateAppointmentResources(db, {
      appointmentId,
      organizationId: world.organizationId,
    });

    // Released, and Dublin's own room taken instead — not left empty.
    expect(await allocatedResourceIds(appointmentId)).toEqual([dublinRoom]);
  });

  it('KEEPS a manual pick that belongs to no branch', async () => {
    // The counterpart, and the one a bare equality gets wrong. A
    // trolley-mounted device has no branch and is available at every one, so a
    // move cannot strand it. Dropping it would release a room the front desk
    // chose, for a reason that does not exist.
    const world = await seedTwoBranchOrg();

    const trolley = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      locationId: null,
      name: 'Mobile laser',
      sortOrder: 0,
    });

    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: world.assigneeId,
      serviceId: world.serviceId,
      startDate: START,
      endDate: END,
      locationId: world.dublinId,
    });

    await seedAllocation({
      organizationId: world.organizationId,
      appointmentId,
      resourceId: trolley,
      startDate: START,
      endDate: END,
      source: 'manual',
    });

    await reallocateAppointmentResources(db, {
      appointmentId,
      organizationId: world.organizationId,
    });

    expect(await allocatedResourceIds(appointmentId)).toEqual([trolley]);
  });

  it('still allocates a room that belongs to no branch', async () => {
    const world = await seedTwoBranchOrg();

    // The trolley. Null location = available everywhere, so a Dublin booking
    // may hold it. A fix written as a bare `location_id = ?` would exclude it.
    const trolley = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      locationId: null,
      name: 'Mobile laser',
      sortOrder: 0,
    });
    await seedEligibility({
      organizationId: world.organizationId,
      serviceId: world.serviceId,
      resourceId: trolley,
    });

    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: world.assigneeId,
      serviceId: world.serviceId,
      startDate: START,
      endDate: END,
      locationId: world.dublinId,
    });

    await reallocateAppointmentResources(db, {
      appointmentId,
      organizationId: world.organizationId,
    });

    expect(await allocatedResourceIds(appointmentId)).toEqual([trolley]);
  });

  it('stays org-wide for an appointment with no branch of its own', async () => {
    // Every row predating the branch rollout is unassigned. Those must keep
    // allocating exactly as before rather than becoming unfulfillable.
    const world = await seedTwoBranchOrg();

    const corkRoom = await seedResource({
      organizationId: world.organizationId,
      categoryId: world.categoryId,
      locationId: world.corkId,
      name: 'Cork Room 1',
      sortOrder: 0,
    });
    await seedEligibility({
      organizationId: world.organizationId,
      serviceId: world.serviceId,
      resourceId: corkRoom,
    });

    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: world.assigneeId,
      serviceId: world.serviceId,
      startDate: START,
      endDate: END,
      locationId: null,
    });

    await reallocateAppointmentResources(db, {
      appointmentId,
      organizationId: world.organizationId,
    });

    expect(await allocatedResourceIds(appointmentId)).toEqual([corkRoom]);
  });
});
