/**
 * `POST /appointments` with an explicit room — over real HTTP.
 *
 * This file exists because the service-level specs could not see the bug it
 * closes. `CreateAppointmentDto` is built from `createAppointmentRequestSchema`,
 * which is `.strict()`, and that schema carried NO `resourceIds` key. So every
 * explicit-room booking was rejected by the validation pipe with a 400 and
 * never reached `createAppointment` at all — while a dozen integration tests
 * calling the service directly passed happily. The transport boundary is the
 * only place that shows up, hence supertest.
 *
 * Behaviour locked here:
 *  - `resourceIds` is accepted by the pipe and the room is genuinely held.
 *  - A BUSY room named explicitly is refused (409) when nobody said otherwise.
 *    Naming a room is a stricter request than "any room": the operator asked
 *    for that one, so silently putting the booking somewhere else — or
 *    silently double-booking — are both wrong answers.
 *  - `allowResourceOverbook: true` turns that same refusal into a booking whose
 *    hold is written `allow_overlap = true`. This is the front desk saying "I
 *    can see the room, I mean it", and it is what makes the UI's inline warning
 *    honest: the client promises the booking will go through, so it must.
 *  - ⚠️ THE FLAG IS CONSOLE-ONLY. An ONLINE booking that sends it is still
 *    refused. A customer on the public booking page must never be able to
 *    double-book a clinic by setting a boolean, whatever the client does — the
 *    server decides, from `source`, not from the body.
 */
import { db } from '@borradh-workspace/database';
import request from 'supertest';
import { AppointmentsController } from '../appointments/appointments.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLead,
  seedOrgWithMember,
  seedUser,
} from './harness.js';
import {
  allocationsFor,
  seedAllocation,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

const CREATED = 201;
const BAD_REQUEST = 400;
const CONFLICT = 409;

/** See appointment-double-booking.int-spec.ts for why the fixture is rebased. */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 1);
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 21);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

const SLOT_START = at('2026-10-01T14:00:00.000Z');
const SLOT_END = at('2026-10-01T15:00:00.000Z');

interface World {
  organizationId: string;
  userId: string;
  leadId: string;
  categoryId: string;
  serviceId: string;
  /** Two capacity-1 rooms; the service requires one from the category. */
  roomIds: string[];
}

async function seedWorld(): Promise<World> {
  const who = await seedOrgWithMember('owner');
  const leadId = await seedLead({ organizationId: who.organizationId });
  const categoryId = await seedResourceCategory({
    organizationId: who.organizationId,
    name: 'Rooms',
  });

  const roomIds: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    roomIds.push(
      await seedResource({
        organizationId: who.organizationId,
        categoryId,
        name: `Room ${index + 1}`,
        sortOrder: index,
      })
    );
  }

  const serviceId = await seedResourceService({
    organizationId: who.organizationId,
    name: 'Laser',
    appointmentDuration: 60,
  });
  await seedRequirement({
    organizationId: who.organizationId,
    serviceId,
    categoryId,
  });

  return {
    organizationId: who.organizationId,
    userId: who.userId,
    leadId,
    categoryId,
    serviceId,
    roomIds,
  };
}

/** Somebody else already holds `resourceId` across the whole fixture slot. */
async function occupy(world: World, resourceId: string): Promise<void> {
  const other = await seedUser();
  const { appointment } = await import('@borradh-workspace/database');
  const id = `appt_${resourceId}_holder`;
  await db.insert(appointment).values({
    id,
    organizationId: world.organizationId,
    leadId: world.leadId,
    assignedToId: other.id,
    title: 'Already in there',
    startDate: SLOT_START,
    endDate: SLOT_END,
    status: 'booked',
    source: 'manual',
  });
  await seedAllocation({
    organizationId: world.organizationId,
    appointmentId: id,
    resourceId,
    startDate: SLOT_START,
    endDate: SLOT_END,
    turnaroundMinutes: 0,
    source: 'auto',
  });
}

describe('POST /appointments with an explicit room (HTTP)', () => {
  let h: IntegrationApp | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  async function build(world: World) {
    h = await buildControllerApp(AppointmentsController, {
      userId: world.userId,
      organizationId: world.organizationId,
    });
    return h;
  }

  const body = (world: World, extra: Record<string, unknown> = {}) => ({
    title: 'Laser — explicit room',
    leadId: world.leadId,
    serviceId: world.serviceId,
    startDate: SLOT_START.toISOString(),
    endDate: SLOT_END.toISOString(),
    ...extra,
  });

  // THE REGRESSION. `.strict()` + a missing key = 400 at the pipe, and the
  // booking never reaches the service the other specs exercise.
  it('accepts resourceIds and actually holds the named room', async () => {
    const world = await seedWorld();
    const app = await build(world);

    const res = await request(app.app.getHttpServer())
      .post('/appointments')
      .send(body(world, { resourceIds: [world.roomIds[1]] }));

    expect(res.status).toBe(CREATED);
    const held = await allocationsFor(res.body.id);
    expect(held.map((row) => row.resourceId)).toEqual([world.roomIds[1]]);
  });

  it('refuses a busy room when nobody asked to overbook', async () => {
    const world = await seedWorld();
    await occupy(world, world.roomIds[0]);
    const app = await build(world);

    const res = await request(app.app.getHttpServer())
      .post('/appointments')
      .send(body(world, { resourceIds: [world.roomIds[0]] }));

    expect(res.status).toBe(CONFLICT);
  });

  it('books the busy room when the operator confirmed the overbook', async () => {
    const world = await seedWorld();
    await occupy(world, world.roomIds[0]);
    const app = await build(world);

    const res = await request(app.app.getHttpServer())
      .post('/appointments')
      .send(
        body(world, {
          resourceIds: [world.roomIds[0]],
          allowResourceOverbook: true,
        })
      );

    expect(res.status).toBe(CREATED);

    const held = await allocationsFor(res.body.id);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(world.roomIds[0]);
    // `allow_overlap` is what opts the row out of `resource_no_overlap`. Had it
    // stayed false the INSERT would have lost to the constraint, so asserting
    // it is asserting the mechanism and not just the status code.
    expect(held[0].allowOverlap).toBe(true);

    // And the room really is shared now — the other booking is untouched.
    const stillThere = await db.query.appointmentResource.findMany({
      where: (t, { eq }) => eq(t.resourceId, world.roomIds[0]),
    });
    expect(stillThere).toHaveLength(2);
  });

  // The one that matters most. The flag is a CONSOLE affordance; `source`
  // decides, not the body.
  it('IGNORES the flag for an online booking, which is still refused', async () => {
    const world = await seedWorld();
    await occupy(world, world.roomIds[0]);
    const app = await build(world);

    const res = await request(app.app.getHttpServer())
      .post('/appointments')
      .send(
        body(world, {
          source: 'booking_form',
          resourceIds: [world.roomIds[0]],
          allowResourceOverbook: true,
        })
      );

    expect(res.status).toBe(CONFLICT);

    // Nothing was written on its behalf: the room still holds exactly the one
    // booking that was there before.
    const holds = await db.query.appointmentResource.findMany({
      where: (t, { eq }) => eq(t.resourceId, world.roomIds[0]),
    });
    expect(holds).toHaveLength(1);
  });

  // The pipe is still strict about everything else — the fix widened the
  // schema by exactly two keys, it did not turn validation off.
  it('still rejects an unknown key with a 400', async () => {
    const world = await seedWorld();
    const app = await build(world);

    const res = await request(app.app.getHttpServer())
      .post('/appointments')
      .send(body(world, { organizationId: 'someone-elses-org' }));

    expect(res.status).toBe(BAD_REQUEST);
  });
});
