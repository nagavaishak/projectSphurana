import request from 'supertest';
/**
 * Fresha domain — appointments CRUD over HTTP (asserted against a real DB).
 *
 * Complements the two existing appointment int-specs, which cover DIFFERENT
 * facets:
 *   - appointment-scoping.int-spec.ts — GET list `view_own` role scoping (HTTP).
 *   - appointment-double-booking.int-spec.ts — overlap/conflict state machine
 *     (drives the services directly, not the controller).
 *
 * The gap this file fills is the plain create → get → list → delete round-trip
 * over the real AppointmentsController HTTP pipeline (the persistence coverage
 * of appointments/appointments.spec.ts). AppointmentsController carries only
 * @UseGuards(AuthGuard); every route is org-scoped from the active org on the
 * faked identity, so the enforced boundary is org isolation.
 *
 * A booking needs a lead (leadId is NOT NULL on the appointment). We create it
 * through the LeadsController so the whole flow is HTTP-driven.
 */
import { AppointmentsController } from '../appointments/appointments.controller.js';
import { LeadsController } from '../leads/leads.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

describe('Fresha domain — appointments CRUD (HTTP)', () => {
  describe('create → get → list → delete round-trip (owner)', () => {
    it('books an appointment, reads it back, lists it, then deletes it', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let leadsApp: IntegrationApp | undefined;
      let apptApp: IntegrationApp | undefined;
      try {
        // Create the client the appointment is booked against.
        leadsApp = await buildControllerApp(LeadsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const lead = await request(leadsApp.app.getHttpServer())
          .post('/leads')
          .send({ firstName: `ApptClient${stamp}` });
        expect(lead.status).toBe(201);
        const leadId: string = lead.body.id;

        apptApp = await buildControllerApp(AppointmentsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = apptApp.app.getHttpServer();

        // create — assignedToId defaults to the caller in the controller.
        const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const title = `Booking ${stamp}`;
        const create = await request(server).post('/appointments').send({
          title,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          leadId,
        });
        expect(create.status).toBe(201);
        const apptId: string = create.body.id;
        expect(apptId).toBeTruthy();
        expect(create.body.title).toBe(title);
        expect(create.body.organizationId).toBe(owner.organizationId);
        expect(create.body.assignedToId).toBe(owner.userId);
        expect(create.body.status).toBe('booked');

        // get reads the persisted row back
        const get = await request(server).get(`/appointments/${apptId}`);
        expect(get.status).toBe(200);
        expect(get.body.id).toBe(apptId);
        expect(get.body.title).toBe(title);

        // list (as owner → whole calendar) includes it
        const list = await request(server).get('/appointments');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((a: { id: string }) => a.id);
        expect(ids).toContain(apptId);

        // delete removes it → subsequent get 404
        const del = await request(server).delete(`/appointments/${apptId}`);
        expect([200, 201]).toContain(del.status);
        const getGone = await request(server).get(`/appointments/${apptId}`);
        expect(getGone.status).toBe(404);
      } finally {
        await apptApp?.close();
        await leadsApp?.close();
      }
    });
  });

  describe('org isolation + DTO validation', () => {
    it('cross-org GET of an org-B appointment → 404; cross-org DELETE is a no-op; empty create body → 400', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let leadsB: IntegrationApp | undefined;
      let apptB: IntegrationApp | undefined;
      let apptA: IntegrationApp | undefined;
      try {
        // Seed an appointment in org B via HTTP.
        leadsB = await buildControllerApp(LeadsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const leadB = await request(leadsB.app.getHttpServer())
          .post('/leads')
          .send({ firstName: `B${stamp}` });
        const leadBId: string = leadB.body.id;

        apptB = await buildControllerApp(AppointmentsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const bAppt = await request(apptB.app.getHttpServer())
          .post('/appointments')
          .send({
            title: `B Booking ${stamp}`,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            leadId: leadBId,
          });
        expect(bAppt.status).toBe(201);
        const bApptId: string = bAppt.body.id;

        // org A cannot see or delete org B's appointment.
        apptA = await buildControllerApp(AppointmentsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = apptA.app.getHttpServer();
        const crossGet = await request(serverA).get(`/appointments/${bApptId}`);
        expect(crossGet.status).toBe(404);

        // The hard-delete path is org-scoped in its WHERE clause (id AND
        // organizationId), so a cross-org delete matches 0 rows and is an
        // idempotent success (200) — it must NOT remove org B's appointment.
        const crossDel = await request(serverA).delete(
          `/appointments/${bApptId}`
        );
        expect([200, 201]).toContain(crossDel.status);

        // proof it survived: org B still reads its appointment.
        const stillThere = await request(apptB.app.getHttpServer()).get(
          `/appointments/${bApptId}`
        );
        expect(stillThere.status).toBe(200);
        expect(stillThere.body.id).toBe(bApptId);

        // empty create body → 400 (title/startDate/endDate/leadId required)
        const bad = await request(serverA).post('/appointments').send({});
        expect(bad.status).toBe(400);
      } finally {
        await apptA?.close();
        await apptB?.close();
        await leadsB?.close();
      }
    });
  });
});
