import request from 'supertest';
/**
 * Fresha domain — catalog services / organization-services (asserted over HTTP
 * against a real DB).
 *
 * Mirrors the timesheets/practitioners/organization-locations exemplars.
 * Exercises the real Nest HTTP pipeline + real feature services + real SQL, with
 * only AuthGuard faked (identity stamped by the harness). Facets:
 *
 *   a. HAPPY ROUND-TRIP — an owner creates a service, it shows up in the list,
 *      is fetched by id, renamed via update, then deleted (subsequent GET → 404).
 *   b. ORG ISOLATION — a service seeded in org-B is invisible to an org-A owner:
 *      absent from the list, and get/update on the org-B id → 404 (the service
 *      WHERE clause is `id AND organizationId`).
 *   c. ROLE BOUNDARY — NONE to assert. The controller carries
 *      `@UseGuards(AuthGuard, RoleGuard)`, but NO method (nor the class) sets a
 *      @RequireRole/@RequirePermission, so RoleGuard passes through — any
 *      authenticated member may CRUD. Like the timesheets exemplar, this spec
 *      pins the rule that IS enforced (org isolation), not an assumed role gate.
 *   d. DTO VALIDATION — create with an empty body → 400 (name is required; the
 *      method ValidationPipe runs after the guards pass).
 *
 * `listServices` returns `{ items, total, limit, offset }`. `getService` returns
 * the bare service row. `deleteService` → the controller returns
 * `{ success: true }`.
 */
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;

describe('Fresha domain — catalog services (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('create → list includes it → get → update → delete → 404', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const created = await request(server)
          .post('/organization-services')
          .send({ name: 'Deep Tissue Massage' });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Deep Tissue Massage');
        expect(created.body.organizationId).toBe(owner.organizationId);
        const id: string = created.body.id;
        expect(id).toBeTruthy();

        // list includes it
        const list = await request(server).get('/organization-services');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.items)).toBe(true);
        expect(list.body.items.some((s: { id: string }) => s.id === id)).toBe(
          true
        );

        // get by id
        const got = await request(server).get(`/organization-services/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.id).toBe(id);

        // update (owner clears the passthrough RoleGuard)
        const updated = await request(server)
          .put(`/organization-services/${id}`)
          .send({ name: 'Sports Massage' });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Sports Massage');

        // delete
        const deleted = await request(server).delete(
          `/organization-services/${id}`
        );
        expect(deleted.status).toBe(200);
        expect(deleted.body.success).toBe(true);

        // gone
        const gone = await request(server).get(`/organization-services/${id}`);
        expect(gone.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('an org-B service is invisible to an org-A owner', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bServiceId = await seedService({
        organizationId: orgB.organizationId,
        name: 'B-only Facial',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        // list excludes org-B
        const list = await request(server).get('/organization-services');
        expect(list.status).toBe(200);
        expect(
          list.body.items.some((s: { id: string }) => s.id === bServiceId)
        ).toBe(false);

        // get on the org-B id → 404
        const got = await request(server).get(
          `/organization-services/${bServiceId}`
        );
        expect(got.status).toBe(NOT_FOUND);

        // update on the org-B id → 404 (service WHERE clause scopes by
        // organizationId; owner clears the passthrough RoleGuard)
        const updated = await request(server)
          .put(`/organization-services/${bServiceId}`)
          .send({ name: 'Nope' });
        expect(updated.status).toBe(NOT_FOUND);
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
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/organization-services')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });
});
