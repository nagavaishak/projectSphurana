import { setFetchInterceptor } from '@borradh-workspace/http';
import {
  createMetaFakeInterceptor,
  resetFakeStore,
} from '@borradh-workspace/integrations/meta-contract';
import request from 'supertest';
/**
 * The seam between OUR services and the Meta contract fake.
 *
 * WHY THIS TIER EXISTS
 * --------------------
 * This is the tier that was missing when `connected-ads` went fully red, and
 * the reason the failure took a ten-minute browser job to see. Below it, both
 * neighbouring tiers were green and stayed green:
 *
 *   - the contract tests assert the PAYLOAD our code builds (`ads.contract.test`)
 *   - the fake's own tests assert the fake ANSWERS correctly (`fake.test`)
 *
 * Neither can see the failure that actually shipped, because it lived in the
 * join: `GET /act_x/campaigns` and `GET /{campaignId}/ads` were undeclared in
 * the registry, so under `marketing` scope they passed through to REAL Meta
 * while creates were served by the fake. `list-campaigns.service.ts` makes
 * Meta's list the SPINE (the local `meta_campaign_config` row only enriches it,
 * and carries no name), so a campaign the fake had just minted could never
 * appear in it. Everything reported healthy; the campaign simply vanished.
 *
 * WHAT IS REAL HERE
 * -----------------
 * Real Nest pipeline, real controller, real feature services, real SQL against
 * a Testcontainers Postgres. Only two things are substituted: the AuthGuard
 * identity (stamped by the harness) and Graph itself (the fake, installed on
 * the same `setFetchInterceptor` seam `install.ts` uses in production).
 *
 * Scope `all`, not `marketing`: this process has no real Meta credentials, so
 * an undeclared endpoint MUST fail loudly here rather than silently escape to
 * the network. That is the same asymmetry `index.ts` documents — and it means
 * this spec fails on a missing registry entry, which is exactly the class of
 * bug it exists to catch.
 */
import { MetaAdsController } from '../meta-ads/meta-ads.controller.js';
import { MetaCampaignsController } from '../meta-campaigns/meta-campaigns.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLocation,
  seedMetaAdsIntegration,
  seedOrgWithMember,
} from './harness.js';

describe('meta-campaigns against the contract fake (HTTP + real DB)', () => {
  let app: IntegrationApp | undefined;

  beforeAll(() => {
    setFetchInterceptor(createMetaFakeInterceptor({ scope: 'all' }));
  });

  afterAll(() => {
    setFetchInterceptor(null);
    resetFakeStore();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function connectedOrg() {
    const owner = await seedOrgWithMember('owner');
    // A campaign takes its geo from a BRANCH now, so an org with no branch
    // cannot create one — `resolveCampaignLocation` refuses with an actionable
    // VALIDATION_ERROR. An org connected to Meta Ads self-evidently has an
    // address, so the fixture grows one; the refusal itself is covered below.
    await seedLocation({ organizationId: owner.organizationId });
    const meta = await seedMetaAdsIntegration({
      organizationId: owner.organizationId,
      userId: owner.userId,
    });
    app = await buildControllerApp(MetaCampaignsController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
    });
    return { ...owner, ...meta, server: app.app.getHttpServer() };
  }

  const draft = (name: string) => ({
    name,
    objective: 'OUTCOME_LEADS',
    dailyBudget: 500,
    followUpType: 'chatbot',
    targeting: { countries: ['IE'] },
  });

  it('refuses to create for an org with no branch, with a fixable message', async () => {
    // The other side of taking geo from a branch. An org that never saved an
    // address used to get a campaign targeted at whatever the caller passed —
    // which is how `countries: ['IE']` sent US and UK spend to Ireland. It must
    // now be a hard stop, and the message has to say what to do about it: this
    // is reachable in prod by any pre-location org.
    const owner = await seedOrgWithMember('owner');
    await seedMetaAdsIntegration({
      organizationId: owner.organizationId,
      userId: owner.userId,
    });
    app = await buildControllerApp(MetaCampaignsController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
    });

    const created = await request(app.app.getHttpServer())
      .post('/meta-campaigns')
      .send(draft(`No Branch ${Date.now()}`));

    expect(created.status).toBe(400);
    expect(created.body.message).toMatch(/no location saved/i);
  });

  it('creates a campaign and finds it in the list, under the name we sent', async () => {
    // THE REGRESSION. Before the list edges were declared, the create
    // succeeded and this list came back without it — indistinguishable, from
    // the outside, from "the API never persisted it".
    const { server } = await connectedOrg();
    const name = `Integration Campaign ${Date.now()}`;

    const created = await request(server)
      .post('/meta-campaigns')
      .send(draft(name));
    expect(created.status).toBe(201);
    expect(created.body.metaCampaignId).toBeTruthy();

    const listed = await request(server).get('/meta-campaigns');
    expect(listed.status).toBe(200);

    const found = listed.body.campaigns.find(
      (c: { id: string }) => c.id === created.body.metaCampaignId
    );
    expect(found).toBeDefined();
    expect(found.name).toBe(name);
  });

  it('mints a distinct id per create, so the same payload twice is two campaigns', async () => {
    // `meta_campaign_config.meta_campaign_id` is globally UNIQUE. The fake used
    // to derive the id by hashing the request body, so a fixture payload seeded
    // twice collided and the second create 422'd with
    // "duplicate key value violates unique constraint".
    const { server } = await connectedOrg();
    const body = draft('Same Name Twice');

    const first = await request(server).post('/meta-campaigns').send(body);
    const second = await request(server).post('/meta-campaigns').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.metaCampaignId).not.toBe(first.body.metaCampaignId);
  });

  it('scopes the list to the org that owns the campaign', async () => {
    const a = await connectedOrg();
    const created = await request(a.server)
      .post('/meta-campaigns')
      .send(draft(`Org A Campaign ${Date.now()}`));
    expect(created.status).toBe(201);
    await app?.close();

    const b = await connectedOrg();
    const listed = await request(b.server).get('/meta-campaigns');

    expect(listed.status).toBe(200);
    expect(
      listed.body.campaigns.map((c: { id: string }) => c.id)
    ).not.toContain(created.body.metaCampaignId);
  });

  it('a rename reads back through the list', async () => {
    const { server } = await connectedOrg();
    const created = await request(server)
      .post('/meta-campaigns')
      .send(draft(`Before Rename ${Date.now()}`));
    expect(created.status).toBe(201);

    const renamed = await request(server)
      .put(`/meta-campaigns/${created.body.metaCampaignId}`)
      .send({ name: 'After Rename' });
    expect(renamed.status).toBe(200);

    const listed = await request(server).get('/meta-campaigns');
    const found = listed.body.campaigns.find(
      (c: { id: string }) => c.id === created.body.metaCampaignId
    );
    expect(found.name).toBe('After Rename');
  });
});

/**
 * The two Graph READS that gate the ad wizard, at the tier where they cost
 * milliseconds. Both were unserved, and both presented as something else:
 * the health read as a blocked UI dialog ("Your ad account is unknown"), the
 * ads edge as a campaign with no ads.
 *
 * The full launch deliberately stays in E2E: the uploader fetches real media
 * bytes from S3, which the fake does not intercept, so faking it here would
 * test a path that doesn't exist.
 */
describe('meta-ads reads that gate publishing', () => {
  let app: IntegrationApp | undefined;

  beforeAll(() => {
    setFetchInterceptor(createMetaFakeInterceptor({ scope: 'all' }));
  });

  afterAll(() => {
    setFetchInterceptor(null);
    resetFakeStore();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('passes the pre-publish account health check', async () => {
    // THE GATE. `getAdAccountHealth` reads account_status off `GET /act_x`;
    // the fake answered that node with funding_source_details alone, so the
    // wizard rendered "Your ad account is unknown" and refused to publish —
    // four ad specs died here without attempting a single Graph write.
    const owner = await seedOrgWithMember('owner');
    await seedMetaAdsIntegration({
      organizationId: owner.organizationId,
      userId: owner.userId,
    });
    app = await buildControllerApp(MetaAdsController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
    });

    const health = await request(app.app.getHttpServer()).get(
      '/meta-ads/health-check'
    );

    expect(health.status).toBe(200);
    // `overall` is 'fail' if ANY check fails — which is what the wizard gates
    // on. Name the failing checks in the message: a bare `expect('fail').toBe
    // ('pass')` sends you back to the browser to find out which one.
    const failed = (
      health.body.checks as Array<{ check: string; status: string }>
    )
      .filter((c) => c.status === 'fail')
      .map((c) => c.check);
    expect(failed).toEqual([]);
    expect(health.body.overall).toBe('pass');
  });

  it('serves the ads edge of a campaign rather than escaping to real Meta', async () => {
    // Under scope `all` an undeclared endpoint THROWS, so this failing at all
    // means `GET /{campaignId}/ads` is unserved — which is exactly how it
    // reached real Meta under `marketing` scope.
    const owner = await seedOrgWithMember('owner');
    // Same reason as `connectedOrg()`: a campaign resolves its geo from a
    // branch, so an org without one cannot create the campaign this test needs
    // in order to reach the ads edge at all.
    await seedLocation({ organizationId: owner.organizationId });
    await seedMetaAdsIntegration({
      organizationId: owner.organizationId,
      userId: owner.userId,
    });

    const campaigns = await buildControllerApp(MetaCampaignsController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
    });
    const created = await request(campaigns.app.getHttpServer())
      .post('/meta-campaigns')
      .send({
        name: `Ads Edge ${Date.now()}`,
        objective: 'OUTCOME_LEADS',
        dailyBudget: 500,
        followUpType: 'chatbot',
        targeting: { countries: ['IE'] },
      });
    expect(created.status).toBe(201);
    await campaigns.close();

    app = await buildControllerApp(MetaAdsController, {
      userId: owner.userId,
      organizationId: owner.organizationId,
    });
    const listed = await request(app.app.getHttpServer()).get(
      `/meta-ads/campaigns/${created.body.metaCampaignId}`
    );

    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.ads)).toBe(true);
  });
});
