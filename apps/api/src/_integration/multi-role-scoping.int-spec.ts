import request from 'supertest';
/**
 * Multi-role scoping (stories 107 / 108), asserted over HTTP.
 *
 * Scenario: a single user is BOTH an `admin` member AND has a practitioner
 * record in the same org. Two orthogonal concepts must not be conflated:
 *
 *   1. CAPABILITY — governed by the `member.role`. An admin has
 *      `appointments:view_all`, so the unscoped GET /appointments returns the
 *      whole org's calendar regardless of their practitioner record.
 *
 *   2. "MY CALENDAR" — a view filtered to the logged-in user's OWN
 *      appointments (assigned to them, or for their practitioner record).
 *
 * IMPORTANT (flagged in the report): there is currently NO first-class
 * "my calendar" endpoint distinct from the capability. The list service can
 * filter by `assignedToId` (a query param) or by `scopeToUserId` (server-set,
 * only for the member tier). An admin who wants *only* their own appointments
 * today must pass `?assignedToId=<self>`, which does NOT include their
 * practitioner-record appointments. The tests below pin down the behaviour
 * that IS expressible; the "my calendar = assigned OR practitioner for an
 * admin" union is the gap to be resolved.
 */
import { AppointmentsController } from '../appointments/appointments.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedAppointment,
  seedMember,
  seedOrganization,
  seedPractitioner,
  seedUser,
} from './harness.js';

describe('Multi-role scoping: admin member + practitioner record (HTTP)', () => {
  it('admin role governs capability: unscoped list returns the whole org', async () => {
    const organizationId = await seedOrganization();

    // This user is an admin AND a practitioner.
    const dualUser = await seedUser();
    await seedMember({
      organizationId,
      userId: dualUser.id,
      role: 'admin',
    });
    await seedPractitioner({ organizationId, userId: dualUser.id });

    const otherUser = await seedUser();
    await seedMember({
      organizationId,
      userId: otherUser.id,
      role: 'member',
    });

    const mineId = await seedAppointment({
      organizationId,
      assignedToId: dualUser.id,
      title: 'Admin own',
    });
    const othersId = await seedAppointment({
      organizationId,
      assignedToId: otherUser.id,
      title: 'Someone else',
    });

    let h: IntegrationApp | undefined;
    try {
      h = await buildControllerApp(AppointmentsController, {
        userId: dualUser.id,
        organizationId,
      });
      // No filter → admin sees the whole org (capability = view_all), NOT just
      // their practitioner appointments.
      const res = await request(h.app.getHttpServer()).get('/appointments');
      expect(res.status).toBe(200);
      const ids = res.body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain(mineId);
      expect(ids).toContain(othersId);
    } finally {
      await h?.close();
    }
  });

  it('"my calendar" via assignedToId filter returns only the admin\'s own assigned appointments', async () => {
    const organizationId = await seedOrganization();

    const dualUser = await seedUser();
    await seedMember({
      organizationId,
      userId: dualUser.id,
      role: 'admin',
    });
    const practitionerId = await seedPractitioner({
      organizationId,
      userId: dualUser.id,
    });

    const otherUser = await seedUser();
    await seedMember({
      organizationId,
      userId: otherUser.id,
      role: 'member',
    });

    const assignedToMeId = await seedAppointment({
      organizationId,
      assignedToId: dualUser.id,
      title: 'Assigned to me',
    });
    // Booked against my practitioner record but assigned to someone else.
    const viaPractitionerId = await seedAppointment({
      organizationId,
      assignedToId: otherUser.id,
      practitionerId,
      title: 'Via my practitioner record',
    });
    const unrelatedId = await seedAppointment({
      organizationId,
      assignedToId: otherUser.id,
      title: 'Unrelated',
    });

    let h: IntegrationApp | undefined;
    try {
      h = await buildControllerApp(AppointmentsController, {
        userId: dualUser.id,
        organizationId,
      });
      const res = await request(h.app.getHttpServer())
        .get('/appointments')
        .query({ assignedToId: dualUser.id });
      expect(res.status).toBe(200);
      const ids = res.body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain(assignedToMeId);
      expect(ids).not.toContain(unrelatedId);

      // KNOWN GAP (flagged): the assignedToId filter does NOT pull in
      // appointments booked against the admin's practitioner record. A true
      // "my calendar" union (assignedTo OR practitioner) has no endpoint yet
      // for the admin tier.
      expect(ids).not.toContain(viaPractitionerId);
    } finally {
      await h?.close();
    }
  });
});
