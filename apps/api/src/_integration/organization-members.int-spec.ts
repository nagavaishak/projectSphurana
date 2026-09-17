import request from 'supertest';
/**
 * Fresha domain — organization members + invitations (over HTTP, real DB).
 *
 * Exercises the two org-team endpoints behind the real MemberGuard/AdminGuard
 * (registered as providers here; they read membership from the DB, so seeded
 * member rows satisfy them) plus the controller's own `assertOrgAccess`
 * (path :id must equal the active org). Four facets:
 *
 *   a. MEMBERS LIST — GET /organizations/:id/members returns the user-joined
 *      array (each row carries `user: { id, name, email, image }`).
 *   b. INVITE — POST /organizations/:id/invitations (owner) creates an invite.
 *   c. ADMIN BOUNDARY — a plain member POSTing an invite → 403 (AdminGuard).
 *   d. ORG SCOPE — acting as org-B, GET org-A's members → 403 (assertOrgAccess).
 */
import { AdminGuard } from '../common/guards/admin.guard.js';
import { MemberGuard } from '../common/guards/member.guard.js';
import { OrganizationsController } from '../organizations/organizations.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const FORBIDDEN = 403;

const guards = [MemberGuard, AdminGuard];

describe('Fresha domain — organization members (HTTP)', () => {
  describe('members list + invite (owner)', () => {
    it('lists the user-joined members and creates an invitation', async () => {
      const owner = await seedOrgWithMember('owner');
      const orgId = owner.organizationId;

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationsController,
          { userId: owner.userId, organizationId: orgId },
          guards
        );
        const server = h.app.getHttpServer();

        // members list carries the joined user
        const list = await request(server).get(
          `/organizations/${orgId}/members`
        );
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body)).toBe(true);
        const self = list.body.find(
          (m: { userId: string }) => m.userId === owner.userId
        );
        expect(self).toBeTruthy();
        expect(self.user.email).toBe(owner.email);

        // invite
        const invite = await request(server)
          .post(`/organizations/${orgId}/invitations`)
          .send({ email: 'grace@example.com' });
        expect(invite.status).toBe(201);
        expect(invite.body.email).toBe('grace@example.com');
        expect(invite.body.status).toBeTruthy();
        expect(invite.body.expiresAt).toBeTruthy();
      } finally {
        await h?.close();
      }
    });
  });

  describe('admin boundary', () => {
    it('a plain member cannot invite → 403', async () => {
      const owner = await seedOrgWithMember('owner');
      const orgId = owner.organizationId;
      const member = await seedOrgWithMember('member', {
        organizationId: orgId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationsController,
          { userId: member.userId, organizationId: orgId },
          guards
        );
        const res = await request(h.app.getHttpServer())
          .post(`/organizations/${orgId}/invitations`)
          .send({ email: 'nope@example.com' });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org scope', () => {
    it("acting as org-B, reading org-A's members → 403", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(
          OrganizationsController,
          { userId: orgB.userId, organizationId: orgB.organizationId },
          guards
        );
        const res = await request(h.app.getHttpServer()).get(
          `/organizations/${orgA.organizationId}/members`
        );
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });
});
