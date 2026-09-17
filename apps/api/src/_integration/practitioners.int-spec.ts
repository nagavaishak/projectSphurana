import request from 'supertest';
/**
 * Fresha domain — practitioners (asserted over HTTP against a real DB).
 *
 * Mirrors the timesheets exemplar. Exercises the real Nest pipeline + real
 * feature services + real SQL, with only AuthGuard faked (RoleGuard runs for
 * real against seeded member rows). Four facets:
 *
 *   a. HAPPY ROUND-TRIP — an owner creates a practitioner, it shows up in the
 *      list, is fetched by id, updated, then deleted (subsequent GET → 404).
 *   b. ORG ISOLATION — a practitioner seeded in org-B is invisible to an org-A
 *      owner: absent from the list, and get/update on the org-B id → 404 (the
 *      service WHERE clause is `id AND organizationId`).
 *   c. ROLE BOUNDARY — the RoleGuard gates writes: create/delete need `owner`,
 *      update needs `admin`. A plain `member` is refused create (403) and
 *      update (403); an `admin` is refused create (403) but allowed update.
 *   d. DTO VALIDATION — create with an empty body → 400 (name/email required;
 *      the method ValidationPipe runs after the guards pass for an owner).
 *
 * `listPractitioners` returns `{ items, limit, offset }` (no total).
 */
import { PractitionersController } from '../practitioners/practitioners.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedPractitioner,
} from './harness.js';

const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const NOT_FOUND = 404;

describe('Fresha domain — practitioners (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('create → list includes it → get → update → delete → 404', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const created = await request(server)
          .post('/practitioners')
          .send({ name: 'Ada Lovelace', email: 'ada@example.com' });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Ada Lovelace');
        expect(created.body.organizationId).toBe(owner.organizationId);
        const id: string = created.body.id;
        expect(id).toBeTruthy();

        // list includes it
        const list = await request(server).get('/practitioners');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.items)).toBe(true);
        expect(list.body.items.some((p: { id: string }) => p.id === id)).toBe(
          true
        );

        // get by id
        const got = await request(server).get(`/practitioners/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.id).toBe(id);

        // update (owner satisfies the @RequireRole('admin') gate)
        const updated = await request(server)
          .put(`/practitioners/${id}`)
          .send({ title: 'Lead Therapist' });
        expect(updated.status).toBe(200);
        expect(updated.body.title).toBe('Lead Therapist');

        // delete
        const deleted = await request(server).delete(`/practitioners/${id}`);
        expect(deleted.status).toBe(200);
        expect(deleted.body.success).toBe(true);

        // gone
        const gone = await request(server).get(`/practitioners/${id}`);
        expect(gone.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('an org-B practitioner is invisible to an org-A owner', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bPractitioner = await seedPractitioner({
        organizationId: orgB.organizationId,
        name: 'Grace Hopper',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        // list excludes org-B
        const list = await request(server).get('/practitioners');
        expect(list.status).toBe(200);
        expect(
          list.body.items.some((p: { id: string }) => p.id === bPractitioner)
        ).toBe(false);

        // get on the org-B id → 404
        const got = await request(server).get(
          `/practitioners/${bPractitioner}`
        );
        expect(got.status).toBe(NOT_FOUND);

        // update on the org-B id → 404 (owner clears the role gate; the service
        // WHERE clause scopes by organizationId)
        const updated = await request(server)
          .put(`/practitioners/${bPractitioner}`)
          .send({ title: 'Nope' });
        expect(updated.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('role boundary', () => {
    it('member is refused create + update; admin is refused create but may update', async () => {
      const owner = await seedOrgWithMember('owner');
      const orgId = owner.organizationId;
      // a member and an admin in the SAME org
      const member = await seedOrgWithMember('member', {
        organizationId: orgId,
      });
      const admin = await seedOrgWithMember('admin', { organizationId: orgId });
      const practitionerId = await seedPractitioner({ organizationId: orgId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: member.userId,
          organizationId: orgId,
        });
        const server = h.app.getHttpServer();

        // member: create needs owner → 403
        const memberCreate = await request(server)
          .post('/practitioners')
          .send({ name: 'X', email: 'x@example.com' });
        expect(memberCreate.status).toBe(FORBIDDEN);

        // member: update needs admin → 403
        const memberUpdate = await request(server)
          .put(`/practitioners/${practitionerId}`)
          .send({ title: 'Y' });
        expect(memberUpdate.status).toBe(FORBIDDEN);

        // admin: create needs owner → 403
        h.actAs({ userId: admin.userId, organizationId: orgId });
        const adminCreate = await request(server)
          .post('/practitioners')
          .send({ name: 'Z', email: 'z@example.com' });
        expect(adminCreate.status).toBe(FORBIDDEN);

        // admin: update clears the admin gate → 200
        const adminUpdate = await request(server)
          .put(`/practitioners/${practitionerId}`)
          .send({ title: 'Ok' });
        expect(adminUpdate.status).toBe(200);
        expect(adminUpdate.body.title).toBe('Ok');
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('create with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/practitioners')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });
});
