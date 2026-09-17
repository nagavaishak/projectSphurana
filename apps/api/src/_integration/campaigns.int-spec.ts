import request from 'supertest';
/**
 * Fresha domain — messaging campaigns over HTTP (asserted against a real DB).
 *
 * Exercises the real Nest HTTP pipeline + real campaign feature services + real
 * SQL, with only the AuthGuard faked (identity stamped by the harness).
 * CampaignsController carries @UseGuards(AuthGuard, RoleGuard); none of the
 * campaign CRUD routes declare @RequireRole/@RequirePermission, so RoleGuard
 * passes through — the enforced boundary on these routes is org isolation.
 *
 * Four facets are proven end to end:
 *   a. HAPPY ROUND-TRIP — create a draft campaign (name + channels), it appears
 *      in the list and is readable by id. `createCampaign` returns the row with
 *      status 'draft' (no `scheduledAt`); `listCampaigns` returns
 *      `{ items, total, limit, offset }` (items carry `recipientCounts` +
 *      `segmentName`), and GET :id returns the campaign row.
 *   b. SEND/VALIDATION GUARD — launching a fresh draft with no audience segment
 *      is refused: `launchCampaign` short-circuits with VALIDATION_ERROR
 *      ("Campaign has no audience segment"), which the controller maps to 400.
 *      (No BullMQ/enqueue is reached — the preflight rejects first.)
 *   c. DTO VALIDATION — POST with an empty body → 400 (name + at least one
 *      channel are required by createCampaignSchema).
 *   d. ORG ISOLATION — the list run as an org-A member returns only org-A
 *      campaigns; a cross-org GET of an org-B campaign id → 404 (the service
 *      WHERE clause is `id AND organizationId`).
 */
import { CampaignsController } from '../campaigns/campaigns.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

describe('Fresha domain — campaigns (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('create draft → list includes it → get reads it back', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(CampaignsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const name = `Campaign ${stamp}`;
        const create = await request(server)
          .post('/campaigns')
          .send({ name, channels: ['email'] });
        expect(create.status).toBe(201);
        const campaignId: string = create.body.id;
        expect(campaignId).toBeTruthy();
        expect(create.body.name).toBe(name);
        expect(create.body.organizationId).toBe(owner.organizationId);
        expect(create.body.status).toBe('draft');
        expect(create.body.type).toBe('custom');
        expect(create.body.channels).toEqual(['email']);

        // list includes the new campaign
        const list = await request(server).get('/campaigns');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((c: { id: string }) => c.id);
        expect(ids).toContain(campaignId);

        // get reads the persisted row back
        const get = await request(server).get(`/campaigns/${campaignId}`);
        expect(get.status).toBe(200);
        expect(get.body.id).toBe(campaignId);
        expect(get.body.name).toBe(name);
      } finally {
        await h?.close();
      }
    });
  });

  describe('send/validation guard', () => {
    it('launching a draft with no audience segment → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(CampaignsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const create = await request(server)
          .post('/campaigns')
          .send({ name: `No segment ${stamp}`, channels: ['email'] });
        expect(create.status).toBe(201);
        const campaignId: string = create.body.id;

        const launch = await request(server).post(
          `/campaigns/${campaignId}/launch`
        );
        expect(launch.status).toBe(400);
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
          .post('/campaigns')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('list returns only org-A campaigns; cross-org GET of an org-B campaign → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const stamp = Date.now();

      let hB: IntegrationApp | undefined;
      let hA: IntegrationApp | undefined;
      try {
        // Seed a campaign in each org via HTTP.
        hA = await buildControllerApp(CampaignsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();
        const aCampaign = await request(serverA)
          .post('/campaigns')
          .send({ name: `A ${stamp}`, channels: ['email'] });
        expect(aCampaign.status).toBe(201);
        const aId: string = aCampaign.body.id;

        hB = await buildControllerApp(CampaignsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bCampaign = await request(hB.app.getHttpServer())
          .post('/campaigns')
          .send({ name: `B ${stamp}`, channels: ['email'] });
        expect(bCampaign.status).toBe(201);
        const bId: string = bCampaign.body.id;

        // org A's list contains its own campaign and NOT org B's.
        const list = await request(serverA).get('/campaigns');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((c: { id: string }) => c.id);
        expect(ids).toContain(aId);
        expect(ids).not.toContain(bId);

        // org A cannot read org B's campaign by id → 404.
        const crossGet = await request(serverA).get(`/campaigns/${bId}`);
        expect(crossGet.status).toBe(404);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });
});
