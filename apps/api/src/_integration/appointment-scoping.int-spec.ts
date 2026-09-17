import request from 'supertest';
/**
 * Appointment `view_own` scoping (stories 85 / 90 / 101), asserted over HTTP.
 *
 * The permission matrix gives `member` only `appointments:view_own` while
 * admin/owner get `appointments:view_all`. The AppointmentsController enforces
 * this by resolving the caller's role and passing `scopeToUserId` to the list
 * service for the member tier. "Own" means an appointment either assigned
 * directly to the user (`assignedToId` → user.id, always set) OR booked against
 * the practitioner record linked to that user (`practitionerId`).
 *
 * GET /appointments is NOT @RequireRole-gated (members must be able to read
 * their calendar), so the scoping happens inside the handler, not the guard.
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

describe('Appointment view_own scoping (HTTP)', () => {
  it('member sees only appointments assigned to them; admin sees all', async () => {
    const organizationId = await seedOrganization();

    const memberUser = await seedUser();
    const otherUser = await seedUser();
    await seedMember({
      organizationId,
      userId: memberUser.id,
      role: 'member',
    });
    await seedMember({
      organizationId,
      userId: otherUser.id,
      role: 'admin',
    });

    // One appointment for the member, one for the other (admin) user.
    const mineId = await seedAppointment({
      organizationId,
      assignedToId: memberUser.id,
      title: 'Mine',
    });
    const theirsId = await seedAppointment({
      organizationId,
      assignedToId: otherUser.id,
      title: 'Theirs',
    });

    let h: IntegrationApp | undefined;
    try {
      h = await buildControllerApp(AppointmentsController, {
        userId: memberUser.id,
        organizationId,
      });

      // Member: only their own appointment.
      const memberRes = await request(h.app.getHttpServer()).get(
        '/appointments'
      );
      expect(memberRes.status).toBe(200);
      const memberIds = memberRes.body.items.map((a: { id: string }) => a.id);
      expect(memberIds).toContain(mineId);
      expect(memberIds).not.toContain(theirsId);
      expect(memberRes.body.items).toHaveLength(1);

      // Admin: the whole org's calendar (both appointments).
      h.actAs({ userId: otherUser.id, organizationId });
      const adminRes = await request(h.app.getHttpServer()).get(
        '/appointments'
      );
      expect(adminRes.status).toBe(200);
      const adminIds = adminRes.body.items.map((a: { id: string }) => a.id);
      expect(adminIds).toContain(mineId);
      expect(adminIds).toContain(theirsId);
    } finally {
      await h?.close();
    }
  });

  it('member also sees appointments for their linked practitioner record', async () => {
    const organizationId = await seedOrganization();

    const memberUser = await seedUser();
    const otherUser = await seedUser();
    await seedMember({
      organizationId,
      userId: memberUser.id,
      role: 'member',
    });

    // The member is also a practitioner. An appointment booked against that
    // practitioner but assigned to a different user must still surface.
    const practitionerId = await seedPractitioner({
      organizationId,
      userId: memberUser.id,
    });
    const viaPractitionerId = await seedAppointment({
      organizationId,
      assignedToId: otherUser.id,
      practitionerId,
      title: 'Via practitioner',
    });
    const unrelatedId = await seedAppointment({
      organizationId,
      assignedToId: otherUser.id,
      title: 'Unrelated',
    });

    let h: IntegrationApp | undefined;
    try {
      h = await buildControllerApp(AppointmentsController, {
        userId: memberUser.id,
        organizationId,
      });
      const res = await request(h.app.getHttpServer()).get('/appointments');
      expect(res.status).toBe(200);
      const ids = res.body.items.map((a: { id: string }) => a.id);
      expect(ids).toContain(viaPractitionerId);
      expect(ids).not.toContain(unrelatedId);
    } finally {
      await h?.close();
    }
  });
});
