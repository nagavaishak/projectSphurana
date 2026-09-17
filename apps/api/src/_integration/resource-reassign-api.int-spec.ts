/**
 * Phase 7 §7f — `PUT /appointments/:id/resources`, over real HTTP.
 *
 * The transport boundary for drag-to-reassign. Everything below the supertest
 * call is the real thing: Nest routing, the global `ZodValidationPipe`, the
 * `@Param()` / `@Body()` decorators, the real feature service and real SQL.
 * Only `AuthGuard` is faked (the harness stamps an identity) — this file is
 * about the boundary, which is where the bugs a service-level test cannot see
 * live.
 *
 * Behaviour locked here:
 *  - A successful move is a 200 carrying the WHOLE allocation view the rooms
 *    calendar renders from — `resourceName`, `resourceColor`,
 *    `turnaroundMinutes`, the range and `source`. A 200 with half the shape
 *    means the room re-renders blank after a drag.
 *  - A busy target is a **409**, not a 500, and carries the service's own
 *    message naming the room — the client turns that into the "Force" prompt
 *    rather than a generic error toast.
 *  - `force: true` is a 200 and the hold is written `allowOverlap: true`.
 *  - ASSIGN (the category held nothing) is a 200 carrying the same full view.
 *  - RELEASE (`resourceId: null`) is a 200 with an EMPTY body — there is no
 *    allocation left to describe — and the room is genuinely re-assignable
 *    afterwards.
 *  - Another org's appointment is a 404. Never that org's data, never a 500.
 *  - NOT role-gated. `role-boundaries.int-spec.ts` establishes member < admin <
 *    owner and gates offers/social/practitioners at admin/owner;
 *    `AppointmentsController` deliberately carries no `@RequireRole`, because
 *    moving a booking between rooms is exactly what front-desk MEMBERS do all
 *    day. A member getting a 403 here is a regression, so it is asserted.
 *  - A malformed body is a 400 from the pipe, and writes nothing.
 *  - ⚠️  THE DTO IS A VALUE IMPORT, asserted on `design:paramtypes`. An
 *    `import type` erases the class, nestjs-zod then sees a plain `Object` and
 *    skips validation for the WHOLE controller — it shipped that way on
 *    `resources.controller.ts` once already. Here the consequence is not a
 *    cosmetic 400: the handler spreads `...dto` AFTER the session's
 *    `organizationId`, so an unvalidated body could OVERRIDE the caller's org.
 *    Both halves are asserted — the metadata, and the cross-org write it
 *    prevents.
 *  - ROUTE ORDER: `PUT /appointments/:id/resources` must resolve to the
 *    reassign handler and not be swallowed by the `PUT /appointments/:id`
 *    declared above it — which would silently turn a room drag into an
 *    appointment update (or a 400 on an unrecognised body).
 */
import { appointment, db, resource } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppointmentsController } from '../appointments/appointments.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedAppointment,
  seedLead,
  seedOrgWithMember,
  seedUser,
} from './harness.js';
import {
  allocationsFor,
  seedAllocation,
  seedResource,
  seedResourceCategory,
} from './seeds/resources.js';

const OK = 200;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const CONFLICT = 409;

/** See appointment-double-booking.int-spec.ts for why the fixture is rebased. */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 1); // earliest literal: 2026-10-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

const SLOT_START = at('2026-10-01T10:00:00.000Z');
const SLOT_END = at('2026-10-01T11:00:00.000Z');
const TURNAROUND_MINUTES = 15;
/** The hold runs past the appointment by the service's cleanup tail. */
const HOLD_END = new Date(SLOT_END.getTime() + TURNAROUND_MINUTES * 60_000);

interface World {
  organizationId: string;
  userId: string;
  leadId: string;
  categoryId: string;
  /** `Room 1`, `Room 2` — capacity 1, `Room 2` is coloured `purple`. */
  roomIds: string[];
}

/**
 * An org whose signed-in user holds `role`, with a Rooms category containing
 * two capacity-1 rooms. `Room 2` is given a colour so `resourceColor` in the
 * response can be asserted as a real value rather than a null that would be
 * "present" whether or not the controller projected it.
 */
async function seedWorld(
  role: 'member' | 'admin' | 'owner' = 'owner'
): Promise<World> {
  const who = await seedOrgWithMember(role);
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
  await db
    .update(resource)
    .set({ color: 'purple' })
    .where(eq(resource.id, roomIds[1]));

  return {
    organizationId: who.organizationId,
    userId: who.userId,
    leadId,
    categoryId,
    roomIds,
  };
}

/** A booking in `world` holding `resourceId` for the fixture slot. */
async function seedBookingHolding(
  world: World,
  resourceId: string,
  opts: { title?: string } = {}
): Promise<{ appointmentId: string; allocationId: string }> {
  const assignee = await seedUser();
  const appointmentId = await seedAppointment({
    organizationId: world.organizationId,
    assignedToId: assignee.id,
    leadId: world.leadId,
    title: opts.title ?? 'Booking',
    startDate: SLOT_START,
    endDate: SLOT_END,
  });
  const allocationId = await seedAllocation({
    organizationId: world.organizationId,
    appointmentId,
    resourceId,
    startDate: SLOT_START,
    endDate: HOLD_END,
    turnaroundMinutes: TURNAROUND_MINUTES,
    source: 'auto',
  });
  return { appointmentId, allocationId };
}

describe('Phase 7 §7f — PUT /appointments/:id/resources (HTTP)', () => {
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
    return h.app.getHttpServer();
  }

  /* ------------------------------------------------------------------ */
  /* Happy path + response shape                                         */
  /* ------------------------------------------------------------------ */

  it('200 with the full allocation view the calendar renders from', async () => {
    const world = await seedWorld();
    const [room1, room2] = world.roomIds;
    const booking = await seedBookingHolding(world, room1);
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${booking.appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: room2 });

    expect(res.status).toBe(OK);
    expect(res.body).toMatchObject({
      id: booking.allocationId,
      appointmentId: booking.appointmentId,
      resourceId: room2,
      resourceName: 'Room 2',
      resourceColor: 'purple',
      categoryId: world.categoryId,
      turnaroundMinutes: TURNAROUND_MINUTES,
      source: 'manual',
      allowOverlap: false,
    });
    // The range is carried verbatim across the wire, turnaround tail included.
    expect(new Date(res.body.startDate).getTime()).toBe(SLOT_START.getTime());
    expect(new Date(res.body.endDate).getTime()).toBe(HOLD_END.getTime());

    // …and it actually landed in the DB, not just in the response body.
    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room2);
    expect(held[0].source).toBe('manual');
  });

  it('200 and a full view when ASSIGNING a category that held nothing', async () => {
    const world = await seedWorld();
    const assignee = await seedUser();
    const appointmentId = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: assignee.id,
      leadId: world.leadId,
      title: 'Booked before rooms existed',
      startDate: SLOT_START,
      endDate: SLOT_END,
    });
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: world.roomIds[1] });

    expect(res.status).toBe(OK);
    expect(res.body).toMatchObject({
      appointmentId,
      resourceId: world.roomIds[1],
      resourceName: 'Room 2',
      resourceColor: 'purple',
      source: 'manual',
    });
    // Nothing in the cart requires this category, so the hold is exactly the
    // appointment's own window.
    expect(new Date(res.body.startDate).getTime()).toBe(SLOT_START.getTime());
    expect(new Date(res.body.endDate).getTime()).toBe(SLOT_END.getTime());

    const held = await allocationsFor(appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(world.roomIds[1]);
  });

  /**
   * RELEASE returns no allocation view, because nothing is held any more.
   * Nest serialises that `null` as an EMPTY 200 body (not `"null"`, not `{}`
   * with fields) — the client must treat "no body" as success, so it is locked
   * here rather than left for a runtime surprise in the calendar.
   */
  it('200 with an empty body when releasing (resourceId: null), and the room frees', async () => {
    const world = await seedWorld();
    const booking = await seedBookingHolding(world, world.roomIds[0]);
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${booking.appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: null });

    expect(res.status).toBe(OK);
    expect(res.text).toBe('');

    // The hold is really gone — a 200 alone would not prove that.
    expect(await allocationsFor(booking.appointmentId)).toHaveLength(0);

    // …and the room can now be taken by a fresh assignment.
    const otherAssignee = await seedUser();
    const otherAppointment = await seedAppointment({
      organizationId: world.organizationId,
      assignedToId: otherAssignee.id,
      leadId: world.leadId,
      title: 'Takes the freed room',
      startDate: SLOT_START,
      endDate: SLOT_END,
    });
    const retake = await request(server)
      .put(`/appointments/${otherAppointment}/resources`)
      .send({ categoryId: world.categoryId, resourceId: world.roomIds[0] });
    expect(retake.status).toBe(OK);
    expect(retake.body.resourceId).toBe(world.roomIds[0]);
  });

  /* ------------------------------------------------------------------ */
  /* Conflict                                                            */
  /* ------------------------------------------------------------------ */

  it('409 (not 500) with the service’s own message when the target is busy', async () => {
    const world = await seedWorld();
    const [room1, room2] = world.roomIds;
    const mover = await seedBookingHolding(world, room1, { title: 'Mover' });
    await seedBookingHolding(world, room2, { title: 'Occupant' });
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${mover.appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: room2 });

    expect(res.status).toBe(CONFLICT);
    // The client renders this verbatim in the "Force?" prompt, so it must be
    // the domain message and not a generic Nest one.
    expect(res.body.message).toBe('Room 2 is already booked for that time');

    // A refused move writes nothing.
    const held = await allocationsFor(mover.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
    expect(held[0].source).toBe('auto');
  });

  it('200 when the same busy move carries force: true', async () => {
    const world = await seedWorld();
    const [room1, room2] = world.roomIds;
    const mover = await seedBookingHolding(world, room1, { title: 'Mover' });
    await seedBookingHolding(world, room2, { title: 'Occupant' });
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${mover.appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: room2, force: true });

    expect(res.status).toBe(OK);
    expect(res.body.resourceId).toBe(room2);
    expect(res.body.allowOverlap).toBe(true);

    const held = await allocationsFor(mover.appointmentId);
    expect(held[0].resourceId).toBe(room2);
    expect(held[0].allowOverlap).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* Cross-org                                                           */
  /* ------------------------------------------------------------------ */

  it("404 for another org's appointment, and none of its data comes back", async () => {
    const mine = await seedWorld();
    const theirs = await seedWorld();
    const theirBooking = await seedBookingHolding(theirs, theirs.roomIds[0], {
      title: 'Their booking',
    });
    const server = await build(mine);

    const res = await request(server)
      .put(`/appointments/${theirBooking.appointmentId}/resources`)
      .send({ categoryId: mine.categoryId, resourceId: mine.roomIds[1] });

    expect(res.status).toBe(NOT_FOUND);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(theirs.organizationId);
    expect(serialized).not.toContain(theirs.roomIds[0]);
    expect(serialized).not.toContain(theirBooking.allocationId);

    // Their hold is exactly where they left it.
    const theirHeld = await allocationsFor(theirBooking.appointmentId);
    expect(theirHeld).toHaveLength(1);
    expect(theirHeld[0].resourceId).toBe(theirs.roomIds[0]);
    expect(theirHeld[0].source).toBe('auto');
  });

  it('400 when the session carries no active organization', async () => {
    const world = await seedWorld();
    const booking = await seedBookingHolding(world, world.roomIds[0]);
    h = await buildControllerApp(AppointmentsController, {
      userId: world.userId,
      organizationId: undefined,
    });

    const res = await request(h.app.getHttpServer())
      .put(`/appointments/${booking.appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: world.roomIds[1] });

    expect(res.status).toBe(BAD_REQUEST);
    const held = await allocationsFor(booking.appointmentId);
    expect(held[0].resourceId).toBe(world.roomIds[0]);
  });

  /* ------------------------------------------------------------------ */
  /* Role boundaries                                                     */
  /* ------------------------------------------------------------------ */

  describe('role boundaries — reassigning is NOT role-gated', () => {
    for (const role of ['member', 'admin', 'owner'] as const) {
      it(`${role} can move a booking between rooms (never 403)`, async () => {
        const world = await seedWorld(role);
        const [room1, room2] = world.roomIds;
        const booking = await seedBookingHolding(world, room1);
        const server = await build(world);

        const res = await request(server)
          .put(`/appointments/${booking.appointmentId}/resources`)
          .send({ categoryId: world.categoryId, resourceId: room2 });

        expect(res.status).not.toBe(FORBIDDEN);
        expect(res.status).toBe(OK);
        // The request really reached the service — a 200 from a short-circuit
        // would not have moved the row.
        const held = await allocationsFor(booking.appointmentId);
        expect(held[0].resourceId).toBe(room2);
      });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Validation at the boundary                                          */
  /* ------------------------------------------------------------------ */

  it('400 on a malformed body, and nothing is written', async () => {
    const world = await seedWorld();
    const [room1, room2] = world.roomIds;
    const booking = await seedBookingHolding(world, room1);
    const server = await build(world);

    const bad: Array<[string, Record<string, unknown>]> = [
      ['missing categoryId', { resourceId: room2 }],
      ['missing resourceId', { categoryId: world.categoryId }],
      [
        'non-boolean force',
        { categoryId: world.categoryId, resourceId: room2, force: 'yes' },
      ],
      ['empty categoryId', { categoryId: '', resourceId: room2 }],
    ];

    for (const [label, body] of bad) {
      const res = await request(server)
        .put(`/appointments/${booking.appointmentId}/resources`)
        .send(body);
      expect([label, res.status]).toEqual([label, BAD_REQUEST]);
    }

    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(room1);
    expect(held[0].source).toBe('auto');
  });

  /**
   * The DTO must be a VALUE import.
   *
   * nestjs-zod's global `ZodValidationPipe` reads the DTO class off
   * `design:paramtypes`. An `import type` erases it, the parameter reports as
   * plain `Object`, and the pipe skips EVERY parameter on the controller —
   * silently. That exact bug shipped on `resources.controller.ts`.
   *
   * Here it is not merely cosmetic. `reassignResource` builds its input as
   * `{ organizationId, appointmentId: id, ...dto }` — the body spread LAST. A
   * body that was never parsed keeps its unknown keys, so a caller could put
   * `organizationId` in it and overwrite the session's org on the way into the
   * service. Zod's object parse strips those keys; that stripping is the only
   * thing standing between the wire and a cross-org write.
   *
   * Both halves are asserted so neither can regress quietly: the runtime
   * metadata, and the behaviour it buys.
   */
  it('validates the DTO at the boundary: body-borne organizationId/appointmentId are stripped', async () => {
    // ── The runtime metadata the pipe depends on. ─────────────────────────
    // Params are (orgId, id, dto); `Object` at [2] means the DTO was erased
    // and NOTHING on this controller is validated.
    const paramTypes: Array<{ name?: string } | undefined> =
      Reflect.getMetadata(
        'design:paramtypes',
        AppointmentsController.prototype,
        'reassignResource'
      ) ?? [];
    expect(paramTypes[2]?.name).toBe('ReassignAppointmentResourceDto');

    // ── The behaviour it buys. ───────────────────────────────────────────
    const mine = await seedWorld();
    const theirs = await seedWorld();
    const [room1, room2] = mine.roomIds;
    const booking = await seedBookingHolding(mine, room1);
    const decoy = await seedBookingHolding(mine, room2, { title: 'Decoy' });
    const server = await build(mine);

    const res = await request(server)
      .put(`/appointments/${booking.appointmentId}/resources`)
      .send({
        categoryId: mine.categoryId,
        resourceId: room2,
        force: true,
        // Both of these would WIN over the controller's own values if the body
        // reached the handler unparsed.
        organizationId: theirs.organizationId,
        appointmentId: decoy.appointmentId,
      });

    // Scoped to the SESSION's org (an unstripped organizationId would have
    // made this a 404 — the appointment does not exist in their org)…
    expect(res.status).toBe(OK);
    // …and applied to the ROUTE's appointment, not the body's.
    expect(res.body.appointmentId).toBe(booking.appointmentId);

    const moved = await allocationsFor(booking.appointmentId);
    expect(moved[0].resourceId).toBe(room2);

    // The decoy named in the body was not touched.
    const decoyHeld = await allocationsFor(decoy.appointmentId);
    expect(decoyHeld).toHaveLength(1);
    expect(decoyHeld[0].resourceId).toBe(room2);
    expect(decoyHeld[0].source).toBe('auto');
  });

  /* ------------------------------------------------------------------ */
  /* Route order                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * `@Put(':id')` is declared ABOVE `@Put(':id/resources')`. Nest matches in
   * declaration order, so if `:id` ever grew a wildcard (or the routes were
   * reordered/rewritten), a room drag would silently become an appointment
   * update: a 400 on an unrecognised body at best, a mangled booking at worst.
   *
   * Proven by sending a body that ONLY the reassign handler understands and
   * checking that (a) the allocation moved and (b) the appointment's own
   * columns are untouched.
   */
  it('PUT :id/resources reaches the reassign handler, not PUT :id', async () => {
    const world = await seedWorld();
    const [room1, room2] = world.roomIds;
    const booking = await seedBookingHolding(world, room1, {
      title: 'Do not rename me',
    });
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${booking.appointmentId}/resources`)
      .send({ categoryId: world.categoryId, resourceId: room2 });

    expect(res.status).toBe(OK);
    // The reassign handler's response shape, which `update` does not return.
    expect(res.body.resourceName).toBe('Room 2');

    const held = await allocationsFor(booking.appointmentId);
    expect(held[0].resourceId).toBe(room2);

    // The appointment itself is untouched — no silent reschedule/rename.
    const row = await db.query.appointment.findFirst({
      where: eq(appointment.id, booking.appointmentId),
      columns: { title: true, startDate: true, endDate: true },
    });
    expect(row?.title).toBe('Do not rename me');
    expect(row?.startDate.getTime()).toBe(SLOT_START.getTime());
    expect(row?.endDate.getTime()).toBe(SLOT_END.getTime());
  });

  it('the sibling PUT :id route still updates the appointment (no shadowing either way)', async () => {
    const world = await seedWorld();
    const booking = await seedBookingHolding(world, world.roomIds[0], {
      title: 'Before',
    });
    const server = await build(world);

    const res = await request(server)
      .put(`/appointments/${booking.appointmentId}`)
      .send({ title: 'After' });

    expect(res.status).toBe(OK);
    const row = await db.query.appointment.findFirst({
      where: eq(appointment.id, booking.appointmentId),
      columns: { title: true },
    });
    expect(row?.title).toBe('After');

    // …and the room hold was NOT disturbed by an appointment-level update.
    const held = await allocationsFor(booking.appointmentId);
    expect(held).toHaveLength(1);
    expect(held[0].resourceId).toBe(world.roomIds[0]);
  });
});
