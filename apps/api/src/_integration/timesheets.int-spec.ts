import request from 'supertest';
/**
 * Fresha domain — timesheets / time-entries (asserted over HTTP against a real DB).
 *
 * This is the EXEMPLAR fresha-domain integration spec; the other eight domains
 * copy its shape. It exercises the real Nest HTTP pipeline + real feature
 * services + real SQL, with only the AuthGuard faked (identity stamped by the
 * harness). Four facets are proven end to end:
 *
 *   a. HAPPY ROUND-TRIP — an owner clocks a practitioner in, the entry shows up
 *      in the list, then clocks out (status → completed).
 *   b. ORG ISOLATION — the list, run as an org-A member, returns only org-A
 *      entries; a cross-org mutation on an org-B entry id → 404 (the service
 *      WHERE clause is `id AND organizationId`).
 *   c. ROLE BOUNDARY — the enforced rule is NOT a RoleGuard on this controller
 *      (it carries only @UseGuards(AuthGuard)); it lives in the clock-in/out
 *      services via the `canManageOthers` flag the controller derives from the
 *      caller's role. A plain member may clock in ONLY their own linked
 *      practitioner: clocking someone else in → 403; their own → not 403.
 *      (`approve`/`delete` are org-scoped only, with no role gate — so this
 *      spec pins the rule that IS enforced, not an assumed one.)
 *   d. DTO VALIDATION — clock-in with an empty body → 400 (practitionerId is
 *      required; the method ValidationPipe runs after the guard).
 *
 * `listTimeEntries` returns the array directly (`ok(items)`), so the GET body is
 * a bare array, not `{ items: [] }`.
 */
import { TimesheetsController } from '../timesheets/timesheets.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedMember,
  seedOrgWithMember,
  seedOrganization,
  seedPractitioner,
  seedTimeEntry,
  seedUser,
} from './harness.js';

const FORBIDDEN = 403;

describe('Fresha domain — timesheets (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('clock-in → list includes it → clock-out completes it', async () => {
      const owner = await seedOrgWithMember('owner');
      const practitionerId = await seedPractitioner({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimesheetsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // clock-in
        const clockIn = await request(server)
          .post('/time-entries/clock-in')
          .send({ practitionerId });
        expect(clockIn.status).toBe(201);
        expect(clockIn.body.practitionerId).toBe(practitionerId);
        expect(clockIn.body.organizationId).toBe(owner.organizationId);
        expect(clockIn.body.status).toBe('open');
        expect(clockIn.body.clockOut).toBeNull();
        const entryId: string = clockIn.body.id;
        expect(entryId).toBeTruthy();

        // list includes the open entry
        const list = await request(server).get('/time-entries');
        expect(list.status).toBe(200);
        const ids = list.body.map((e: { id: string }) => e.id);
        expect(ids).toContain(entryId);

        // clock-out completes it
        const clockOut = await request(server)
          .post(`/time-entries/${entryId}/clock-out`)
          .send({});
        expect([200, 201]).toContain(clockOut.status);
        expect(clockOut.body.id).toBe(entryId);
        expect(clockOut.body.status).toBe('completed');
        expect(clockOut.body.clockOut).not.toBeNull();
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('list returns only org-A entries; cross-org mutation on org-B entry → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const pracA = await seedPractitioner({
        organizationId: orgA.organizationId,
      });
      const pracA2 = await seedPractitioner({
        organizationId: orgA.organizationId,
      });
      const pracB = await seedPractitioner({
        organizationId: orgB.organizationId,
      });

      const a1 = await seedTimeEntry({
        organizationId: orgA.organizationId,
        practitionerId: pracA,
        clockOut: new Date(Date.now() - 30 * 60 * 1000),
      });
      const a2 = await seedTimeEntry({
        organizationId: orgA.organizationId,
        practitionerId: pracA2,
        clockOut: new Date(Date.now() - 20 * 60 * 1000),
      });
      const b1 = await seedTimeEntry({
        organizationId: orgB.organizationId,
        practitionerId: pracB,
        clockOut: new Date(Date.now() - 10 * 60 * 1000),
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimesheetsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/time-entries');
        expect(list.status).toBe(200);
        const ids = list.body.map((e: { id: string }) => e.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A mutating org B's entry → 404 (approve is org-scoped, no role gate)
        const cross = await request(server).post(`/time-entries/${b1}/approve`);
        expect(cross.status).toBe(404);

        // sanity: org A's own entry IS reachable via the same mutation
        const own = await request(server).post(`/time-entries/${a1}/approve`);
        expect(own.status).not.toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  describe('role boundary (canManageOthers, enforced in the service)', () => {
    it('member clocking SOMEONE ELSE in → 403', async () => {
      const organizationId = await seedOrganization();
      const memberUser = await seedUser();
      await seedMember({
        organizationId,
        userId: memberUser.id,
        role: 'member',
      });
      // A practitioner NOT linked to the calling member.
      const othersPractitioner = await seedPractitioner({ organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimesheetsController, {
          userId: memberUser.id,
          organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/time-entries/clock-in')
          .send({ practitionerId: othersPractitioner });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member clocking THEIR OWN linked practitioner in → not 403', async () => {
      const organizationId = await seedOrganization();
      const memberUser = await seedUser();
      await seedMember({
        organizationId,
        userId: memberUser.id,
        role: 'member',
      });
      // A practitioner linked to the calling member.
      const ownPractitioner = await seedPractitioner({
        organizationId,
        userId: memberUser.id,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimesheetsController, {
          userId: memberUser.id,
          organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/time-entries/clock-in')
          .send({ practitionerId: ownPractitioner });
        expect(res.status).not.toBe(FORBIDDEN);
        expect(res.status).toBe(201);
        expect(res.body.practitionerId).toBe(ownPractitioner);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('clock-in with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(TimesheetsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/time-entries/clock-in')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
