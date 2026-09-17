import request from 'supertest';
/**
 * Fresha domain — organization locations (asserted over HTTP against a real DB).
 *
 * Mirrors the timesheets/practitioners exemplars. The controller carries only
 * @UseGuards(AuthGuard) (no role gate), so any member may CRUD; the guard we
 * exercise for real is org-scoping. Three facets:
 *
 *   a. HAPPY ROUND-TRIP — create → list includes it → update → delete → the
 *      list no longer includes it.
 *   b. ORG ISOLATION — a location created while acting as an org-B member is
 *      absent from an org-A member's list, and update on the org-B id → 404.
 *   c. DTO VALIDATION — create with an empty body → 400 (addressLine1/city/
 *      country are required).
 *
 * `listLocations` returns `{ items }` (no pagination meta).
 */
import { OrganizationLocationsController } from '../organization-locations/organization-locations.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLocation,
  seedOrgWithMember,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;

const aLocationBody = (over: Record<string, unknown> = {}) => ({
  name: 'Main Clinic',
  addressLine1: '1 Grafton Street',
  city: 'Dublin',
  country: 'ie',
  ...over,
});

describe('Fresha domain — organization locations (HTTP)', () => {
  describe('happy round-trip', () => {
    it('create → list includes it → update → delete → gone from list', async () => {
      const owner = await seedOrgWithMember('owner');
      // A SECOND branch, so the delete below is a legitimate one.
      //
      // `4c19781c9` added "an organization must have at least one location" —
      // an org with none has no default branch to resolve, so every
      // branch-scoped read and write loses its anchor. This spec predates that
      // guard and deleted the only location it had, which is now correctly a
      // 409. The guard itself is asserted separately below.
      await seedLocation({
        organizationId: owner.organizationId,
        name: 'Keeper',
        isPrimary: true,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationLocationsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/organization-locations')
          .send(aLocationBody({ name: 'Grafton Clinic' }));
        expect(created.status).toBe(201);
        expect(created.body.organizationId).toBe(owner.organizationId);
        const id: string = created.body.id;
        expect(id).toBeTruthy();

        const list = await request(server).get('/organization-locations');
        expect(list.status).toBe(200);
        expect(list.body.items.some((l: { id: string }) => l.id === id)).toBe(
          true
        );

        const updated = await request(server)
          .put(`/organization-locations/${id}`)
          .send({ name: 'Renamed Clinic' });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Renamed Clinic');

        const deleted = await request(server).delete(
          `/organization-locations/${id}`
        );
        expect(deleted.status).toBe(200);
        expect(deleted.body.success).toBe(true);

        const after = await request(server).get('/organization-locations');
        expect(after.body.items.some((l: { id: string }) => l.id === id)).toBe(
          false
        );
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it("an org-B location is absent from org-A's list and not updatable", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationLocationsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const server = h.app.getHttpServer();

        // create a location in org-B
        const created = await request(server)
          .post('/organization-locations')
          .send(aLocationBody({ name: 'B Clinic' }));
        expect(created.status).toBe(201);
        const bLocationId: string = created.body.id;

        // switch to org-A
        h.actAs({ userId: orgA.userId, organizationId: orgA.organizationId });

        const list = await request(server).get('/organization-locations');
        expect(list.status).toBe(200);
        expect(
          list.body.items.some((l: { id: string }) => l.id === bLocationId)
        ).toBe(false);

        const updated = await request(server)
          .put(`/organization-locations/${bLocationId}`)
          .send({ name: 'Nope' });
        expect(updated.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('the last location', () => {
    it('refuses to delete the ONLY location, and it survives', async () => {
      // The guard `4c19781c9` added. An org with zero locations has no default
      // branch to resolve, so every branch-scoped surface loses its anchor —
      // and the message says the actionable thing rather than "make another
      // one primary first", which is unactionable when there is no other one.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationLocationsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/organization-locations')
          .send(aLocationBody({ name: 'The only one' }));
        expect(created.status).toBe(201);

        const deleted = await request(server).delete(
          `/organization-locations/${created.body.id}`
        );

        expect(deleted.status).toBe(CONFLICT);
        expect(deleted.body.message).toMatch(/only location/i);

        // Refused, not half-done.
        const after = await request(server).get('/organization-locations');
        expect(
          after.body.items.some((l: { id: string }) => l.id === created.body.id)
        ).toBe(true);
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
        h = await buildControllerApp(OrganizationLocationsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/organization-locations')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });
});
