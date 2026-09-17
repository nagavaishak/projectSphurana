import request from 'supertest';
/**
 * Fresha domain — audience segments (asserted over HTTP against a real DB).
 *
 * Segments are the audience filters that messaging campaigns target. They are
 * served by the CampaignsController under the static `/campaigns/segments*`
 * routes (declared before the `:id` param routes so they aren't swallowed).
 * The controller carries `@UseGuards(AuthGuard, RoleGuard)`; no segment route
 * sets @RequireRole/@RequirePermission, so RoleGuard passes through and the
 * enforced boundary is org isolation. Only AuthGuard is faked by the harness.
 *
 * Facets:
 *   a. HAPPY ROUND-TRIP — an owner creates a segment (name + filterJson), it
 *      appears in the list and is readable by id. `createSegment` returns the
 *      persisted row (`organizationId`, `name`, `filterJson`, `isDynamic`
 *      defaulting to true); `listSegments` returns `{ items, total, limit,
 *      offset }`; GET :id returns the bare segment row. (There is no
 *      recipient-count on the create/list/get shapes — recipient counting lives
 *      on the separate `POST /campaigns/segments/preview` route, out of scope.)
 *   b. DTO VALIDATION — POST with an empty body → 400 (createSegmentSchema
 *      requires `name` and a `filterJson` object).
 *   c. ORG-ISOLATION (list) — a segment seeded in org-B is absent from an
 *      org-A owner's list (`listSegments` WHERE clause scopes by
 *      organizationId). THIS PASSES.
 *   d. ORG-ISOLATION (get/update by id) — SPEC / EXPECTED-FAIL. Unlike
 *      `getCampaign`/`getLeadForm`, the `getSegment` and `updateSegment`
 *      services DO NOT scope their WHERE clause by organizationId — they match
 *      only `eq(segment.id, ...) AND notDeleted(...)`. With RLS off (as in this
 *      harness) that lets org-A read/mutate an org-B segment by id. These tests
 *      assert the DESIRED 404 (test-as-spec) and WILL FAIL until the services
 *      add `eq(segment.organizationId, input.organizationId)` to their WHERE,
 *      mirroring the get-campaign defence-in-depth fix. See the report.
 */
import { CampaignsController } from '../campaigns/campaigns.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;

describe('Fresha domain — segments (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('create → list includes it → get reads it back', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(CampaignsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const name = `Segment ${stamp}`;
        const create = await request(server)
          .post('/campaigns/segments')
          .send({ name, filterJson: { consentEmail: true } });
        expect(create.status).toBe(201);
        const segmentId: string = create.body.id;
        expect(segmentId).toBeTruthy();
        expect(create.body.name).toBe(name);
        expect(create.body.organizationId).toBe(owner.organizationId);
        // isDynamic defaults to true in createSegmentSchema.
        expect(create.body.isDynamic).toBe(true);
        expect(create.body.filterJson).toEqual({ consentEmail: true });

        // list includes the new segment
        const list = await request(server).get('/campaigns/segments');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.items)).toBe(true);
        const ids = list.body.items.map((s: { id: string }) => s.id);
        expect(ids).toContain(segmentId);

        // get reads the persisted row back
        const get = await request(server).get(
          `/campaigns/segments/${segmentId}`
        );
        expect(get.status).toBe(200);
        expect(get.body.id).toBe(segmentId);
        expect(get.body.name).toBe(name);
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
        h = await buildControllerApp(CampaignsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/campaigns/segments')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation — list', () => {
    it('an org-A list excludes org-B segments', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        // Seed a segment in each org via HTTP.
        hB = await buildControllerApp(CampaignsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bSeg = await request(hB.app.getHttpServer())
          .post('/campaigns/segments')
          .send({ name: `B ${stamp}`, filterJson: { consentSms: true } });
        expect(bSeg.status).toBe(201);
        const bId: string = bSeg.body.id;

        hA = await buildControllerApp(CampaignsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();
        const aSeg = await request(serverA)
          .post('/campaigns/segments')
          .send({ name: `A ${stamp}`, filterJson: { consentEmail: true } });
        expect(aSeg.status).toBe(201);
        const aId: string = aSeg.body.id;

        // org A's list contains its own segment and NOT org B's.
        const list = await request(serverA).get('/campaigns/segments');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((s: { id: string }) => s.id);
        expect(ids).toContain(aId);
        expect(ids).not.toContain(bId);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });

  describe('org isolation — get/update by id (SPEC: expected-fail until scoped)', () => {
    // NOTE: These assertions encode the DESIRED behaviour. They currently FAIL
    // because getSegment/updateSegment do NOT scope their WHERE clause by
    // organizationId (they match only `id AND notDeleted`). Fix the services by
    // adding `eq(segment.organizationId, input.organizationId)` — mirroring the
    // getCampaign fix — and these turn green. See the isolation-gap note.
    it('cross-org GET of an org-B segment → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(CampaignsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bSeg = await request(hB.app.getHttpServer())
          .post('/campaigns/segments')
          .send({ name: `B ${stamp}`, filterJson: { consentSms: true } });
        expect(bSeg.status).toBe(201);
        const bId: string = bSeg.body.id;

        hA = await buildControllerApp(CampaignsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const crossGet = await request(hA.app.getHttpServer()).get(
          `/campaigns/segments/${bId}`
        );
        expect(crossGet.status).toBe(NOT_FOUND);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });

    it('cross-org PUT of an org-B segment → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let hA: IntegrationApp | undefined;
      let hB: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(CampaignsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bSeg = await request(hB.app.getHttpServer())
          .post('/campaigns/segments')
          .send({ name: `B ${stamp}`, filterJson: { consentSms: true } });
        expect(bSeg.status).toBe(201);
        const bId: string = bSeg.body.id;

        hA = await buildControllerApp(CampaignsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const crossUpdate = await request(hA.app.getHttpServer())
          .put(`/campaigns/segments/${bId}`)
          .send({ name: `hijacked ${stamp}` });
        expect(crossUpdate.status).toBe(NOT_FOUND);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });
});
