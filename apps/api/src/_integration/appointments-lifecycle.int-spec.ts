import request from 'supertest';
/**
 * Fresha domain — appointment LIFECYCLE over HTTP (asserted against a real DB).
 *
 * Complements the three existing appointment int-specs, which cover DIFFERENT
 * facets and are deliberately NOT re-asserted here:
 *   - appointments.int-spec.ts        — plain create → get → list → delete
 *     round-trip + cross-org GET/DELETE isolation + empty-body 400.
 *   - appointment-scoping.int-spec.ts — GET list `view_own` role scoping.
 *   - appointment-double-booking.int-spec.ts — overlap/conflict state machine
 *     (drives the services directly, incl. reschedule-frees-old-slot and
 *     cancel-frees-slot at the SERVICE layer).
 *
 * The gap this file fills is the mutation lifecycle over the real
 * AppointmentsController HTTP pipeline (PUT /appointments/:id):
 *   a. RESCHEDULE — moving an appointment's start/end persists the new window
 *      and echoes it back (the HTTP-level reschedule, distinct from the
 *      service-level slot-freeing already proven).
 *   b. STATUS TRANSITIONS — confirm → complete, plus no_show and cancel, each
 *      driven through PUT and read back. Status is set freely (no ordered state
 *      machine); overlap enforcement is online-only, so manual-source status
 *      edits never trip a conflict.
 *   c. ORG ISOLATION on the mutation path — org A PUT-ing an org-B appointment
 *      (reschedule OR status) → 404 (the update service WHERE clause is
 *      `id AND organizationId`); org A's own appointment IS reachable.
 *
 * AppointmentsController carries only @UseGuards(AuthGuard); every route is
 * org-scoped from the active org on the faked identity. Leads are seeded
 * directly (leadId is NOT NULL on the appointment) rather than via the
 * LeadsController, keeping the focus on the appointment routes.
 */
import { AppointmentsController } from '../appointments/appointments.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedAppointment,
  seedLead,
  seedOrgWithMember,
} from './harness.js';

/** Book an appointment via the controller; returns its id. */
async function createAppointmentViaHttp(
  server: ReturnType<IntegrationApp['app']['getHttpServer']>,
  input: { leadId: string; title: string; start: Date; end: Date }
): Promise<string> {
  const res = await request(server).post('/appointments').send({
    title: input.title,
    startDate: input.start.toISOString(),
    endDate: input.end.toISOString(),
    leadId: input.leadId,
  });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('booked');
  return res.body.id as string;
}

describe('Fresha domain — appointment lifecycle (HTTP)', () => {
  describe('reschedule (PUT start/end)', () => {
    it('moving an appointment persists the new window', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();
      const leadId = await seedLead({ organizationId: owner.organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(AppointmentsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const apptId = await createAppointmentViaHttp(server, {
          leadId,
          title: `Reschedule me ${stamp}`,
          start,
          end,
        });

        // Move it 3 hours later.
        const newStart = new Date(start.getTime() + 3 * 60 * 60 * 1000);
        const newEnd = new Date(newStart.getTime() + 30 * 60 * 1000);
        const moved = await request(server)
          .put(`/appointments/${apptId}`)
          .send({
            startDate: newStart.toISOString(),
            endDate: newEnd.toISOString(),
          });
        expect(moved.status).toBe(200);
        expect(moved.body.id).toBe(apptId);
        expect(new Date(moved.body.startDate).toISOString()).toBe(
          newStart.toISOString()
        );
        expect(new Date(moved.body.endDate).toISOString()).toBe(
          newEnd.toISOString()
        );

        // Read-back confirms persistence.
        const get = await request(server).get(`/appointments/${apptId}`);
        expect(get.status).toBe(200);
        expect(new Date(get.body.startDate).toISOString()).toBe(
          newStart.toISOString()
        );
      } finally {
        await h?.close();
      }
    });
  });

  describe('status transitions (PUT status)', () => {
    it('confirm → complete each persist and read back', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();
      const leadId = await seedLead({ organizationId: owner.organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(AppointmentsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const apptId = await createAppointmentViaHttp(server, {
          leadId,
          title: `Lifecycle ${stamp}`,
          start,
          end,
        });

        const confirmed = await request(server)
          .put(`/appointments/${apptId}`)
          .send({ status: 'confirmed' });
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.status).toBe('confirmed');

        const completed = await request(server)
          .put(`/appointments/${apptId}`)
          .send({ status: 'completed' });
        expect(completed.status).toBe(200);
        expect(completed.body.status).toBe('completed');

        const get = await request(server).get(`/appointments/${apptId}`);
        expect(get.status).toBe(200);
        expect(get.body.status).toBe('completed');
      } finally {
        await h?.close();
      }
    });

    it('no_show and cancel each persist', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();
      const leadId = await seedLead({ organizationId: owner.organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(AppointmentsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const base = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const noShowId = await createAppointmentViaHttp(server, {
          leadId,
          title: `No show ${stamp}`,
          start: base,
          end: new Date(base.getTime() + 30 * 60 * 1000),
        });
        // Distinct window so the same assignee never overlaps.
        const cancelStart = new Date(base.getTime() + 3 * 60 * 60 * 1000);
        const cancelId = await createAppointmentViaHttp(server, {
          leadId,
          title: `Cancel ${stamp}`,
          start: cancelStart,
          end: new Date(cancelStart.getTime() + 30 * 60 * 1000),
        });

        const noShow = await request(server)
          .put(`/appointments/${noShowId}`)
          .send({ status: 'no_show' });
        expect(noShow.status).toBe(200);
        expect(noShow.body.status).toBe('no_show');

        const cancelled = await request(server)
          .put(`/appointments/${cancelId}`)
          .send({ status: 'cancelled' });
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.status).toBe('cancelled');
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation on the mutation path', () => {
    it('org A PUT (reschedule + status) on an org-B appointment → 404; own → not 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      // Seed org B's appointment directly (assignee = org B's user).
      const bApptId = await seedAppointment({
        organizationId: orgB.organizationId,
        assignedToId: orgB.userId,
        startDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 4.5 * 60 * 60 * 1000),
      });

      // Org A's own appointment, to prove the same mutation IS reachable.
      const aApptId = await seedAppointment({
        organizationId: orgA.organizationId,
        assignedToId: orgA.userId,
        startDate: new Date(Date.now() + 6 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 6.5 * 60 * 60 * 1000),
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(AppointmentsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        // Cross-org status change → 404.
        const crossStatus = await request(server)
          .put(`/appointments/${bApptId}`)
          .send({ status: 'confirmed' });
        expect(crossStatus.status).toBe(404);

        // Cross-org reschedule → 404.
        const crossMove = await request(server)
          .put(`/appointments/${bApptId}`)
          .send({
            startDate: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
            endDate: new Date(Date.now() + 8.5 * 60 * 60 * 1000).toISOString(),
          });
        expect(crossMove.status).toBe(404);

        // Sanity: org A's own appointment IS reachable via the same mutation.
        const own = await request(server)
          .put(`/appointments/${aApptId}`)
          .send({ status: 'confirmed' });
        expect(own.status).not.toBe(404);
        expect(own.status).toBe(200);
        expect(own.body.status).toBe('confirmed');
      } finally {
        await h?.close();
      }
    });
  });
});
