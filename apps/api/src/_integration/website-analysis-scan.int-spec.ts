import {
  db,
  organization,
  organizationLocation,
  organizationPackage,
  organizationPackageItem,
  organizationService,
  practitioner,
} from '@borradh-workspace/database';
import { getRedis } from '@borradh-workspace/redis';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Website scan — Settings > Organisation details (ENG-659) and the venue
 * description (ENG-645), asserted over HTTP against a REAL Postgres.
 *
 * WHY THIS FILE EXISTS. The feature already has thorough unit coverage
 * (`plan-website-analysis.test.ts`, `apply-website-analysis.test.ts`), but every
 * one of those tests mocks BOTH the database and each collaborator service —
 * `createService`, `createPackage`, `createPractitioner`, `updateLocationVenue`,
 * `updateOrganizationSettings`. They pin the planner's arithmetic and prove the
 * apply CALLS the right function with the right argument. They cannot prove the
 * call lands: no column is ever written, no constraint is ever enforced, and the
 * `jobId` indirection that carries the analysis from Redis to the apply — the
 * whole tenant boundary — is never exercised at all.
 *
 * REAL here: the HTTP pipeline, ZodValidationPipe, the DTOs, the Redis job
 * store, the planner, the apply, every collaborator service, and the SQL. Every
 * write is READ BACK FROM POSTGRES.
 * FAKED: AuthGuard only (identity stamping) — as in every spec in this folder.
 *
 * The scan itself (fetching a website, calling OpenAI) is NOT exercised. Jobs
 * are seeded into Redis in the exact shape `startAnalyzeWebsiteJob` writes, so
 * these tests start where a finished scan ends — which is also the only shape
 * `preview`/`apply` can ever see.
 */
import { WebsiteAnalysisController } from '../website-analysis/website-analysis.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const CREATED = 201;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A finished scan result, in the shape `analyzeWebsiteResponseSchema` produces.
 *
 * `getAnalyzeWebsiteJob` re-parses `result` through that schema and DROPS it
 * when it fails — which would make the job read as "not finished" and every
 * assertion below vacuous. So the fixture carries the schema's required fields
 * (`targetAudienceDescription`, `brandVoice`, `suggestedCredibilityLines`)
 * whether or not a given test cares about them.
 */
const anAnalysis = (over: Record<string, unknown> = {}) => ({
  services: [],
  targetAudienceDescription: 'Adults seeking aesthetic treatments',
  brandVoice: ['warm', 'clinical'],
  suggestedCredibilityLines: [],
  ...over,
});

/**
 * Write a finished analyze job straight into Redis under the key
 * `startAnalyzeWebsiteJob` would have used.
 *
 * Seeding the store rather than running a scan is the point: `preview`/`apply`
 * take only a `jobId` and re-read the server's own copy, so this is exactly the
 * state they consume in production.
 */
const seedJob = async (input: {
  organizationId?: string;
  scanFor?: string[];
  result?: Record<string, unknown>;
  status?: 'pending' | 'done' | 'error';
  error?: string;
}): Promise<string> => {
  const jobId = `wa:int-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await getRedis().set(
    jobId,
    JSON.stringify({
      status: input.status ?? 'done',
      phase: input.status === 'error' ? 'error' : 'done',
      organizationId: input.organizationId,
      scanFor: input.scanFor,
      error: input.error,
      result:
        input.status === 'error' ? undefined : (input.result ?? anAnalysis()),
    }),
    'EX',
    600
  );
  return jobId;
};

const seedLocation = async (input: {
  organizationId: string;
  addressLine1?: string;
  city?: string;
  country?: 'ie' | 'gb';
  isPrimary?: boolean;
  about?: string | null;
}): Promise<string> => {
  const [row] = await db
    .insert(organizationLocation)
    .values({
      organizationId: input.organizationId,
      addressLine1: input.addressLine1 ?? '1 Grafton Street',
      city: input.city ?? 'Dublin',
      country: input.country ?? 'ie',
      isPrimary: input.isPrimary ?? false,
      about: input.about ?? null,
    })
    .returning({ id: organizationLocation.id });
  return row.id;
};

const seedExistingService = async (input: {
  organizationId: string;
  name: string;
  priceType?: 'fixed' | 'from' | 'poa' | 'free';
  priceCents?: number | null;
  isActive?: boolean;
}): Promise<string> => {
  const [row] = await db
    .insert(organizationService)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      priceType: input.priceType ?? 'fixed',
      priceCents: input.priceCents ?? null,
      isActive: input.isActive ?? true,
    })
    .returning({ id: organizationService.id });
  return row.id;
};

/* --- read-back helpers: every assertion goes through these --------- */

const readServices = (organizationId: string) =>
  db
    .select()
    .from(organizationService)
    .where(eq(organizationService.organizationId, organizationId));

const readPractitioners = (organizationId: string) =>
  db
    .select()
    .from(practitioner)
    .where(eq(practitioner.organizationId, organizationId));

const readPackages = (organizationId: string) =>
  db
    .select()
    .from(organizationPackage)
    .where(eq(organizationPackage.organizationId, organizationId));

const readLocations = (organizationId: string) =>
  db
    .select()
    .from(organizationLocation)
    .where(eq(organizationLocation.organizationId, organizationId));

const readOrg = async (organizationId: string) => {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId));
  return row;
};

/* ------------------------------------------------------------------ */

describe('website scan — preview + apply (HTTP, real DB)', () => {
  let h: IntegrationApp;
  let server: ReturnType<IntegrationApp['app']['getHttpServer']>;

  /**
   * One app, re-identified per test via `actAs`. The controller is
   * constructor-free and holds no per-request state, so building it once is
   * equivalent to building it per test and saves a Nest boot on every case.
   */
  beforeAll(async () => {
    h = await buildControllerApp(WebsiteAnalysisController, {
      userId: 'placeholder',
      organizationId: undefined,
    });
    server = h.app.getHttpServer();
  });

  afterAll(async () => {
    await h?.close();
  });

  /** Seed an org + owner and act as them. Returns the org id. */
  const actAsFreshOwner = async (): Promise<{
    organizationId: string;
    userId: string;
  }> => {
    const owner = await seedOrgWithMember('owner');
    h.actAs({ userId: owner.userId, organizationId: owner.organizationId });
    return owner;
  };

  const preview = (jobId: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/website-analysis/preview')
      .send({ jobId, ...extra });

  const apply = (jobId: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/website-analysis/apply')
      .send({ jobId, ...extra });

  /* ================================================================== */
  /* A. Tenant boundary — the reason apply takes a jobId, not an analysis */
  /* ================================================================== */

  describe('tenant boundary', () => {
    it("refuses another organization's scan and writes nothing", async () => {
      // The scan belongs to org B…
      const orgB = await seedOrgWithMember('owner');
      const jobId = await seedJob({
        organizationId: orgB.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: 'Stolen Treatment', priceType: 'fixed', priceAmount: 50 },
          ],
        }),
      });

      // …and org A asks for it by id.
      const orgA = await actAsFreshOwner();

      const previewed = await preview(jobId);
      expect(previewed.status).toBe(NOT_FOUND);

      const applied = await apply(jobId);
      expect(applied.status).toBe(NOT_FOUND);

      // Neither tenant was touched — not the caller, and not the owner of the
      // job. A 404 that still wrote somewhere would be worse than a 200.
      await expect(readServices(orgA.organizationId)).resolves.toHaveLength(0);
      await expect(readServices(orgB.organizationId)).resolves.toHaveLength(0);
    });

    it('ignores an analysis posted in the body — only the job is trusted', async () => {
      // The whole reason the wire contract carries a jobId and not an analysis:
      // a client that posts its own catalog must not be able to write it.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: 'Genuine Facial', priceType: 'fixed', priceAmount: 80 },
          ],
        }),
      });

      const applied = await apply(jobId, {
        analysis: {
          services: [
            { name: 'Injected Service', priceType: 'fixed', priceAmount: 9999 },
          ],
          targetAudienceDescription: 'x',
          brandVoice: [],
          suggestedCredibilityLines: [],
        },
        scanFor: ['services', 'team', 'packages'],
      });
      expect(applied.status).toBe(CREATED);

      const services = await readServices(owner.organizationId);
      expect(services.map((s) => s.name)).toEqual(['Genuine Facial']);
    });

    it('rejects a session with no active organization', async () => {
      const owner = await seedOrgWithMember('owner');
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
      });

      h.actAs({ userId: owner.userId, organizationId: undefined });

      await expect(preview(jobId).then((r) => r.status)).resolves.toBe(
        BAD_REQUEST
      );
      await expect(apply(jobId).then((r) => r.status)).resolves.toBe(
        BAD_REQUEST
      );
    });

    it('serves an onboarding job (one with no organization) to the caller', async () => {
      // DELIBERATE, and pinned so a change is a decision rather than an
      // accident: the scanner runs several steps BEFORE the organization
      // exists, so an onboarding job carries no organizationId and
      // `getAnalyzeWebsiteJob` skips the tenant check for it. The jobId is a
      //
      // random, 10-minute-TTL Redis key, which is what stands in for scoping
      // during that window.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: undefined,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: 'Onboarding Facial', priceType: 'fixed', priceAmount: 70 },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);

      const services = await readServices(owner.organizationId);
      expect(services.map((s) => s.name)).toEqual(['Onboarding Facial']);
    });
  });

  /* ================================================================== */
  /* B. Job preconditions                                                */
  /* ================================================================== */

  describe('job preconditions', () => {
    it('404s an unknown or expired job', async () => {
      await actAsFreshOwner();
      const res = await preview('wa:does-not-exist');
      expect(res.status).toBe(NOT_FOUND);
    });

    it('409s a scan that has not finished', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        status: 'pending',
      });

      const res = await apply(jobId);
      expect(res.status).toBe(CONFLICT);
      expect(res.body.message).toMatch(/not finished/i);
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(0);
    });

    it("409s a scan that failed, and surfaces the scan's own reason", async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        status: 'error',
        error: 'Website analysis timed out.',
      });

      const res = await apply(jobId);
      expect(res.status).toBe(CONFLICT);
      expect(res.body.message).toBe('Website analysis timed out.');
    });

    it('409s a job marked done that carries no result', async () => {
      const owner = await actAsFreshOwner();
      const jobId = `wa:int-resultless-${Math.random().toString(36).slice(2)}`;
      await getRedis().set(
        jobId,
        JSON.stringify({
          status: 'done',
          phase: 'done',
          organizationId: owner.organizationId,
        }),
        'EX',
        600
      );

      const res = await apply(jobId);
      expect(res.status).toBe(CONFLICT);
    });

    it('rejects an empty body at the boundary, not in the service', async () => {
      await actAsFreshOwner();
      const res = await request(server)
        .post('/website-analysis/apply')
        .send({});
      expect(res.status).toBe(BAD_REQUEST);
    });
  });

  /* ================================================================== */
  /* C. The central claim: the plan previewed is the plan applied        */
  /* ================================================================== */

  describe('preview and apply agree', () => {
    it('applies exactly the counts the preview described', async () => {
      const owner = await actAsFreshOwner();
      await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Existing Facial',
        priceType: 'fixed',
        priceCents: 5000,
      });

      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            // price moved 50.00 -> 65.00
            { name: 'Existing Facial', priceType: 'fixed', priceAmount: 65 },
            { name: 'New Peel', priceType: 'fixed', priceAmount: 120 },
          ],
        }),
      });

      const previewed = await preview(jobId);
      expect(previewed.status).toBe(CREATED);
      expect(previewed.body.services.create).toHaveLength(1);
      expect(previewed.body.services.priceChanges).toHaveLength(1);

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);
      expect(applied.body.createdServiceIds).toHaveLength(
        previewed.body.services.create.length
      );
      expect(applied.body.servicesPriceUpdated).toBe(
        previewed.body.services.priceChanges.length
      );
      expect(applied.body.skipped).toEqual([]);

      const services = await readServices(owner.organizationId);
      expect(services).toHaveLength(2);
      const existing = services.find((s) => s.name === 'Existing Facial');
      expect(existing?.priceCents).toBe(6500);
    });

    it('diffs against live state, not against the preview it showed', async () => {
      // The account can change between the two calls (another window, a
      // teammate). The apply rebuilds the plan, so the row it was going to
      // create is now a match — and must not be created twice.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: 'Hydrafacial', priceType: 'fixed', priceAmount: 90 },
          ],
        }),
      });

      const previewed = await preview(jobId);
      expect(previewed.body.services.create).toHaveLength(1);

      // …meanwhile, someone adds it by hand, at the same price.
      await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Hydrafacial',
        priceType: 'fixed',
        priceCents: 9000,
      });

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);
      expect(applied.body.createdServiceIds).toEqual([]);

      const services = await readServices(owner.organizationId);
      expect(services).toHaveLength(1);
    });

    it('is idempotent — re-applying the same scan adds nothing', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        result: anAnalysis({
          services: [
            {
              name: 'Laser Hair Removal',
              priceType: 'fixed',
              priceAmount: 200,
            },
          ],
          practitioners: [{ name: 'Dr Aoife Byrne', title: 'Lead Clinician' }],
          businessDescription: 'A calm clinic on Grafton Street.',
        }),
      });
      await seedLocation({
        organizationId: owner.organizationId,
        isPrimary: true,
      });

      const first = await apply(jobId);
      expect(first.status).toBe(CREATED);
      expect(first.body.createdServiceIds).toHaveLength(1);
      expect(first.body.practitionersCreated).toBe(1);

      const second = await apply(jobId);
      expect(second.status).toBe(CREATED);
      expect(second.body.createdServiceIds).toEqual([]);
      expect(second.body.practitionersCreated).toBe(0);

      await expect(readServices(owner.organizationId)).resolves.toHaveLength(1);
      await expect(
        readPractitioners(owner.organizationId)
      ).resolves.toHaveLength(1);
    });

    it('does not duplicate a service whose name differs only in case', async () => {
      const owner = await actAsFreshOwner();
      await seedExistingService({
        organizationId: owner.organizationId,
        name: 'HYDRAFACIAL',
        priceType: 'fixed',
        priceCents: 9000,
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: '  hydrafacial ', priceType: 'fixed', priceAmount: 90 },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.createdServiceIds).toEqual([]);
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(1);
    });
  });

  /* ================================================================== */
  /* D. Service columns actually written                                 */
  /* ================================================================== */

  describe('service rows', () => {
    it('writes the scanned price onto a real row', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            {
              name: 'Dermal Filler',
              priceType: 'from',
              priceAmount: 250,
              pricingDescription: 'From €250 per syringe',
            },
          ],
        }),
      });

      expect((await apply(jobId)).status).toBe(CREATED);

      const [row] = await readServices(owner.organizationId);
      expect(row.name).toBe('Dermal Filler');
      expect(row.priceType).toBe('from');
      expect(row.priceCents).toBe(25000);
      expect(row.priceText).toBe('From €250 per syringe');
      expect(row.isActive).toBe(true);
    });

    it('stores an unreadable price as POA with no number', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [{ name: 'Consultation', priceType: 'poa' }],
        }),
      });

      expect((await apply(jobId)).status).toBe(CREATED);

      const [row] = await readServices(owner.organizationId);
      expect(row.priceType).toBe('poa');
      expect(row.priceCents).toBeNull();
    });

    it('never overwrites a real price with an unreadable one', async () => {
      const owner = await actAsFreshOwner();
      await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Consultation',
        priceType: 'fixed',
        priceCents: 4500,
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [{ name: 'Consultation', priceType: 'poa' }],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.servicesPriceUpdated).toBe(0);

      const [row] = await readServices(owner.organizationId);
      expect(row.priceCents).toBe(4500);
    });
  });

  /* ================================================================== */
  /* E. replace DEACTIVATES — it never deletes                           */
  /* ================================================================== */

  describe('replace mode', () => {
    it('deactivates the row rather than deleting it', async () => {
      const owner = await actAsFreshOwner();
      const staleId = await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Retired Offer',
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({ services: [] }),
      });

      const applied = await apply(jobId, { modes: { services: 'replace' } });
      expect(applied.status).toBe(CREATED);
      expect(applied.body.servicesDeactivated).toBe(1);

      // The row is STILL THERE — appointment and package history resolve
      // through it, which is the entire reason this is a deactivate.
      const [row] = await db
        .select()
        .from(organizationService)
        .where(eq(organizationService.id, staleId));
      expect(row).toBeDefined();
      expect(row.isActive).toBe(false);
    });

    it('leaves the row alone in the default additive mode', async () => {
      const owner = await actAsFreshOwner();
      const staleId = await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Retired Offer',
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({ services: [] }),
      });

      const applied = await apply(jobId);
      expect(applied.body.servicesDeactivated).toBe(0);

      const [row] = await db
        .select()
        .from(organizationService)
        .where(eq(organizationService.id, staleId));
      expect(row.isActive).toBe(true);
    });

    it('keeps a row the owner un-ticked active, even in replace mode', async () => {
      const owner = await actAsFreshOwner();
      const keepId = await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Keep Me',
      });
      const dropId = await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Drop Me',
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({ services: [] }),
      });

      const previewed = await preview(jobId);
      const keepKey = previewed.body.services.notFound.find(
        (r: { id: string }) => r.id === keepId
      ).key;

      const applied = await apply(jobId, {
        modes: { services: 'replace' },
        deselected: [keepKey],
      });
      expect(applied.body.servicesDeactivated).toBe(1);

      const rows = await readServices(owner.organizationId);
      expect(rows.find((r) => r.id === keepId)?.isActive).toBe(true);
      expect(rows.find((r) => r.id === dropId)?.isActive).toBe(false);
    });

    it('does not re-propose an already-inactive row', async () => {
      const owner = await actAsFreshOwner();
      await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Long Gone',
        isActive: false,
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({ services: [] }),
      });

      const previewed = await preview(jobId);
      expect(previewed.body.services.notFound).toEqual([]);

      const applied = await apply(jobId, { modes: { services: 'replace' } });
      expect(applied.body.servicesDeactivated).toBe(0);
    });
  });

  /* ================================================================== */
  /* F. ENG-645 — the venue description reaches the booking page         */
  /* ================================================================== */

  describe('venue description (ENG-645)', () => {
    it('writes onto the PRIMARY location, not the organization', async () => {
      const owner = await actAsFreshOwner();
      const secondaryId = await seedLocation({
        organizationId: owner.organizationId,
        addressLine1: '2 Side Street',
        isPrimary: false,
      });
      const primaryId = await seedLocation({
        organizationId: owner.organizationId,
        addressLine1: '1 Main Street',
        isPrimary: true,
      });

      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['description'],
        result: anAnalysis({
          businessDescription: 'A calm clinic in the heart of Dublin.',
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.venueDescriptionUpdated).toBe(true);

      const locations = await readLocations(owner.organizationId);
      expect(locations.find((l) => l.id === primaryId)?.about).toBe(
        'A calm clinic in the heart of Dublin.'
      );
      // The sibling branch keeps its own copy — this is per-venue prose.
      expect(locations.find((l) => l.id === secondaryId)?.about).toBeNull();
    });

    it('leaves the existing description alone when the owner says ignore', async () => {
      const owner = await actAsFreshOwner();
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
        isPrimary: true,
        about: 'Copy the owner wrote by hand.',
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['description'],
        result: anAnalysis({ businessDescription: 'Scraped replacement.' }),
      });

      const applied = await apply(jobId, { modes: { description: 'ignore' } });
      expect(applied.body.venueDescriptionUpdated).toBe(false);

      const locations = await readLocations(owner.organizationId);
      expect(locations.find((l) => l.id === locationId)?.about).toBe(
        'Copy the owner wrote by hand.'
      );
    });

    it('lands on a location created in the same apply', async () => {
      // The onboarding shape: a brand-new org has nowhere to put the prose
      // until this same apply creates the address.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['location', 'description'],
        result: anAnalysis({
          businessDescription: 'Brand new venue copy.',
          locations: [
            {
              name: 'Grafton Clinic',
              addressLine1: '12 Grafton Street',
              city: 'Dublin',
              country: 'ie',
            },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.locationsCreated).toBe(1);
      expect(applied.body.venueDescriptionUpdated).toBe(true);

      const [location] = await readLocations(owner.organizationId);
      expect(location.about).toBe('Brand new venue copy.');
      // First address an org ever gets becomes the primary one.
      expect(location.isPrimary).toBe(true);
    });

    it('reports the gap when there is nowhere to write it', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['description'],
        result: anAnalysis({ businessDescription: 'Homeless prose.' }),
      });

      const applied = await apply(jobId);
      expect(applied.body.venueDescriptionUpdated).toBe(false);
      expect(applied.body.skipped.join(' ')).toMatch(/add a location first/i);
    });
  });

  /* ================================================================== */
  /* G. Locations                                                        */
  /* ================================================================== */

  describe('locations', () => {
    it('matches an existing address despite punctuation and does not duplicate', async () => {
      const owner = await actAsFreshOwner();
      await seedLocation({
        organizationId: owner.organizationId,
        addressLine1: '12 Grafton St.',
        isPrimary: true,
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['location'],
        result: anAnalysis({
          locations: [
            { addressLine1: '12 Grafton St', city: 'Dublin', country: 'IE' },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.locationsCreated).toBe(0);
      await expect(readLocations(owner.organizationId)).resolves.toHaveLength(
        1
      );
    });

    it('never moves an established primary branch on a rescan', async () => {
      const owner = await actAsFreshOwner();
      const originalPrimary = await seedLocation({
        organizationId: owner.organizationId,
        addressLine1: '1 Original Street',
        isPrimary: true,
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['location'],
        result: anAnalysis({
          locations: [
            {
              addressLine1: '1 Original Street',
              city: 'Dublin',
              country: 'ie',
            },
            { addressLine1: '99 New Branch Road', city: 'Cork', country: 'ie' },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.locationsCreated).toBe(1);

      const locations = await readLocations(owner.organizationId);
      expect(locations.filter((l) => l.isPrimary).map((l) => l.id)).toEqual([
        originalPrimary,
      ]);
    });

    it('blocks an unrecognised country and writes no row', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['location'],
        result: anAnalysis({
          locations: [
            {
              addressLine1: '1 Nowhere Lane',
              city: 'Atlantis',
              country: 'Wakanda',
            },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.locationsCreated).toBe(0);
      expect(applied.body.skipped.join(' ')).toMatch(/Wakanda/);
      await expect(readLocations(owner.organizationId)).resolves.toHaveLength(
        0
      );
    });
  });

  /* ================================================================== */
  /* H. Packages — real rows, real items                                 */
  /* ================================================================== */

  describe('packages', () => {
    it('creates the bundle with item rows pointing at the created services', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['packages'], // implies services
        result: anAnalysis({
          services: [
            { name: 'Laser Session', priceType: 'fixed', priceAmount: 100 },
            { name: 'Aftercare Facial', priceType: 'fixed', priceAmount: 40 },
          ],
          packages: [
            {
              name: 'Laser Course',
              description: 'Six sessions plus aftercare',
              priceAmount: 500,
              serviceNames: ['Laser Session', 'Aftercare Facial'],
              validityDays: 365,
            },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);
      expect(applied.body.packagesCreated).toBe(1);

      const [pkg] = await readPackages(owner.organizationId);
      expect(pkg.name).toBe('Laser Course');
      expect(pkg.priceCents).toBe(50000);
      expect(pkg.validityDays).toBe(365);

      const items = await db
        .select()
        .from(organizationPackageItem)
        .where(eq(organizationPackageItem.packageId, pkg.id));
      expect(items).toHaveLength(2);

      const services = await readServices(owner.organizationId);
      const serviceIds = new Set(services.map((s) => s.id));
      for (const item of items) {
        expect(serviceIds.has(item.serviceId)).toBe(true);
      }
    });

    it('collapses a repeated item into a quantity rather than a duplicate row', async () => {
      // organization_package_item is UNIQUE on (package_id, service_id) — a
      // naive two-row insert would violate it and lose the whole package.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['packages'],
        result: anAnalysis({
          services: [
            { name: 'Laser Session', priceType: 'fixed', priceAmount: 100 },
          ],
          packages: [
            {
              name: 'Double Laser',
              priceAmount: 180,
              serviceNames: ['Laser Session', 'Laser Session'],
            },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.packagesCreated).toBe(1);

      const [pkg] = await readPackages(owner.organizationId);
      const items = await db
        .select()
        .from(organizationPackageItem)
        .where(eq(organizationPackageItem.packageId, pkg.id));
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(2);
    });

    it('writes no package at all when an item cannot be resolved', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['packages'],
        result: anAnalysis({
          services: [
            { name: 'Laser Session', priceType: 'fixed', priceAmount: 100 },
          ],
          packages: [
            {
              name: 'Phantom Bundle',
              priceAmount: 300,
              serviceNames: ['Laser Session', 'Massage We Never Offer'],
            },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.packagesCreated).toBe(0);
      expect(applied.body.skipped.join(' ')).toMatch(/Massage We Never Offer/);
      await expect(readPackages(owner.organizationId)).resolves.toHaveLength(0);
      // The service it COULD resolve still landed — one bad bundle does not
      // roll back the catalog.
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(1);
    });

    it('blocks a bundle whose only service the owner un-ticked', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['packages'],
        result: anAnalysis({
          services: [
            { name: 'Laser Session', priceType: 'fixed', priceAmount: 100 },
          ],
          packages: [
            {
              name: 'Laser Course',
              priceAmount: 500,
              serviceNames: ['Laser Session'],
            },
          ],
        }),
      });

      const previewed = await preview(jobId);
      const serviceKey = previewed.body.services.create[0].key;

      const applied = await apply(jobId, { deselected: [serviceKey] });
      expect(applied.body.createdServiceIds).toEqual([]);
      expect(applied.body.packagesCreated).toBe(0);
      await expect(readPackages(owner.organizationId)).resolves.toHaveLength(0);
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(0);
    });

    it('deactivates a package the scan did not find, in replace mode', async () => {
      const owner = await actAsFreshOwner();
      const [stale] = await db
        .insert(organizationPackage)
        .values({
          organizationId: owner.organizationId,
          name: 'Old Bundle',
          priceCents: 10000,
        })
        .returning({ id: organizationPackage.id });

      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['packages'],
        result: anAnalysis({ services: [], packages: [] }),
      });

      const applied = await apply(jobId, { modes: { packages: 'replace' } });
      expect(applied.body.packagesDeactivated).toBe(1);

      const [row] = await db
        .select()
        .from(organizationPackage)
        .where(eq(organizationPackage.id, stale.id));
      expect(row).toBeDefined();
      expect(row.isActive).toBe(false);
    });
  });

  /* ================================================================== */
  /* I. Team — placeholder emails against the REAL unique index          */
  /* ================================================================== */

  describe('team', () => {
    it('mints distinct undeliverable placeholders for names that slug alike', async () => {
      // `practitioner_org_email_unique` is a real unique index. Two staff whose
      // names slug to the same local part ("Anna Kelly" / "Anna-Kelly") are the
      // case that makes the collision suffix load-bearing — with the DB mocked
      // out, a generator that ignored `taken` would still pass.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['team'],
        result: anAnalysis({
          practitioners: [
            { name: 'Anna Kelly', title: 'Aesthetician' },
            { name: 'Anna-Kelly', title: 'Nurse' },
          ],
        }),
      });

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);
      expect(applied.body.practitionersCreated).toBe(2);
      expect(applied.body.skipped).toEqual([]);

      const staff = await readPractitioners(owner.organizationId);
      const emails = staff.map((p) => p.email).sort();
      expect(emails).toEqual([
        'anna.kelly.2@scraped.invalid',
        'anna.kelly@scraped.invalid',
      ]);
      // RFC 6761 reserves `.invalid` so these can never resolve to a mailbox.
      for (const email of emails) {
        expect(email.endsWith('@scraped.invalid')).toBe(true);
      }
    });

    it('uses the address the site actually published', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['team'],
        result: anAnalysis({
          practitioners: [
            {
              name: 'Dr Sean Moore',
              email: 'sean@realclinic.ie',
              title: 'Doctor',
            },
          ],
        }),
      });

      expect((await apply(jobId)).status).toBe(CREATED);

      const [row] = await readPractitioners(owner.organizationId);
      expect(row.email).toBe('sean@realclinic.ie');
      expect(row.title).toBe('Doctor');
    });

    it('deactivates staff the scan did not find, in replace mode', async () => {
      const owner = await actAsFreshOwner();
      const [stale] = await db
        .insert(practitioner)
        .values({
          organizationId: owner.organizationId,
          name: 'Departed Therapist',
          email: 'departed@example.com',
        })
        .returning({ id: practitioner.id });

      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['team'],
        result: anAnalysis({ practitioners: [] }),
      });

      const applied = await apply(jobId, { modes: { team: 'replace' } });
      expect(applied.body.practitionersDeactivated).toBe(1);

      const [row] = await db
        .select()
        .from(practitioner)
        .where(eq(practitioner.id, stale.id));
      expect(row).toBeDefined();
      expect(row.isActive).toBe(false);
    });
  });

  /* ================================================================== */
  /* J. Hours and brand land on the organization row                     */
  /* ================================================================== */

  describe('hours and brand', () => {
    it('writes both onto the organization in one settings update', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['hours', 'brand'],
        result: anAnalysis({
          businessHours: { '1': { from: 540, to: 1020 } },
          primaryColor: '#112233',
          secondaryColor: '#445566',
          logoUrl: 'https://example.com/logo.png',
        }),
      });

      const applied = await apply(jobId);
      expect(applied.body.openingHoursUpdated).toBe(true);
      expect(applied.body.brandUpdated).toBe(true);

      const org = await readOrg(owner.organizationId);
      expect(org.businessHours).toEqual({ '1': { from: 540, to: 1020 } });
      expect(org.primaryColor).toBe('#112233');
      expect(org.secondaryColor).toBe('#445566');
      expect(org.logo).toBe('https://example.com/logo.png');
    });

    it('leaves brand untouched when the owner ignores that section', async () => {
      const owner = await actAsFreshOwner();
      await db
        .update(organization)
        .set({ primaryColor: '#aaaaaa' })
        .where(eq(organization.id, owner.organizationId));

      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['hours', 'brand'],
        result: anAnalysis({
          businessHours: { '2': { from: 600, to: 1080 } },
          primaryColor: '#112233',
        }),
      });

      const applied = await apply(jobId, { modes: { brand: 'ignore' } });
      expect(applied.body.brandUpdated).toBe(false);
      expect(applied.body.openingHoursUpdated).toBe(true);

      const org = await readOrg(owner.organizationId);
      expect(org.primaryColor).toBe('#aaaaaa');
      expect(org.businessHours).toEqual({ '2': { from: 600, to: 1080 } });
    });
  });

  /* ================================================================== */
  /* K. scanFor — "not on their website" vs "we never looked"            */
  /* ================================================================== */

  describe('scan scope', () => {
    it('a services-only scan never proposes touching team or packages', async () => {
      // The bug this prevents: a narrow scan returns empty team/packages
      // arrays, which look identical to "the site lists none" — and a replace
      // would then wipe the whole section.
      const owner = await actAsFreshOwner();
      const [staff] = await db
        .insert(practitioner)
        .values({
          organizationId: owner.organizationId,
          name: 'Still Employed',
          email: 'still@example.com',
        })
        .returning({ id: practitioner.id });
      const [pkg] = await db
        .insert(organizationPackage)
        .values({
          organizationId: owner.organizationId,
          name: 'Still Sold',
          priceCents: 20000,
        })
        .returning({ id: organizationPackage.id });

      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({ services: [], practitioners: [], packages: [] }),
      });

      const previewed = await preview(jobId);
      expect(previewed.body.scanned).toEqual(['services']);
      expect(previewed.body.team.notFound).toEqual([]);
      expect(previewed.body.packages.notFound).toEqual([]);

      // Even asking for replace on every section cannot reach what was never
      // scanned.
      const applied = await apply(jobId, {
        modes: { services: 'replace', team: 'replace', packages: 'replace' },
      });
      expect(applied.body.practitionersDeactivated).toBe(0);
      expect(applied.body.packagesDeactivated).toBe(0);

      const [staffRow] = await db
        .select()
        .from(practitioner)
        .where(eq(practitioner.id, staff.id));
      expect(staffRow.isActive).toBe(true);
      const [pkgRow] = await db
        .select()
        .from(organizationPackage)
        .where(eq(organizationPackage.id, pkg.id));
      expect(pkgRow.isActive).toBe(true);
    });

    it('a packages scan implies services', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['packages'],
        result: anAnalysis(),
      });

      const previewed = await preview(jobId);
      expect(previewed.body.scanned).toEqual(
        expect.arrayContaining(['services', 'packages'])
      );
    });

    it('an unscoped job is diffed across every section', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: undefined,
        result: anAnalysis(),
      });

      const previewed = await preview(jobId);
      expect(previewed.body.scanned).toEqual(
        expect.arrayContaining([
          'brand',
          'description',
          'services',
          'packages',
          'location',
          'hours',
          'team',
        ])
      );
    });
  });

  /* ================================================================== */
  /* L. Deselection over the wire                                        */
  /* ================================================================== */

  describe('deselection', () => {
    it('drops exactly the row the owner un-ticked and writes the rest', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: 'Keep This', priceType: 'fixed', priceAmount: 10 },
            { name: 'Drop This', priceType: 'fixed', priceAmount: 20 },
          ],
        }),
      });

      const previewed = await preview(jobId);
      const dropKey = previewed.body.services.create.find(
        (r: { name: string }) => r.name === 'Drop This'
      ).key;

      const applied = await apply(jobId, { deselected: [dropKey] });
      expect(applied.body.createdServiceIds).toHaveLength(1);

      const services = await readServices(owner.organizationId);
      expect(services.map((s) => s.name)).toEqual(['Keep This']);
    });

    it('treats a key that matches no row as inert', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [{ name: 'Survivor', priceType: 'fixed', priceAmount: 30 }],
        }),
      });

      const applied = await apply(jobId, {
        deselected: ['service.create:nothing-like-this'],
      });
      expect(applied.body.createdServiceIds).toHaveLength(1);
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(1);
    });

    it('rejects a deselection list past the cap at the boundary', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
      });

      // Short keys on purpose: at ~20 bytes each, 5001 realistic keys exceed
      // Nest's 100kb body limit and the request dies at 413 before the schema
      // is ever consulted — which would pass while testing nothing about the
      // cap.
      const res = await apply(jobId, {
        deselected: Array.from({ length: 5001 }, (_, i) => `k${i}`),
      });
      expect(res.status).toBe(BAD_REQUEST);
    });

    it('rejects a mode the schema does not define', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
      });

      const res = await apply(jobId, { modes: { services: 'delete' } });
      expect(res.status).toBe(BAD_REQUEST);
    });

    it('refuses to let locations be replaced — add or ignore only', async () => {
      // organization_location has no isActive, so "replace" could only ever
      // mean a hard delete of an address that booking history points at.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['location'],
      });

      const res = await apply(jobId, { modes: { locations: 'replace' } });
      expect(res.status).toBe(BAD_REQUEST);
    });
  });

  /* ================================================================== */
  /* M. Resilience — a thin or damaged snapshot must not 500             */
  /* ================================================================== */

  describe('degraded snapshots', () => {
    it('applies the readable half of a snapshot with a malformed section', async () => {
      // Shape drift across a deploy is the realistic failure here: a job
      // written by the previous release fails the CURRENT response schema on
      // one field. The poll view drops such a result wholesale — correct for
      // its consumer, which iterates those arrays — but the apply reads the
      // RAW stored result and runs it through `websiteAnalysisSnapshotSchema`,
      // whose every field is `.catch()`-guarded so the readable parts land.
      //
      // Before that split, one bad section cost the entire scan and surfaced
      // as "the scan has not finished yet", which describes the wrong problem.
      const owner = await actAsFreshOwner();
      const jobId = `wa:int-degraded-${Math.random().toString(36).slice(2)}`;
      await getRedis().set(
        jobId,
        JSON.stringify({
          status: 'done',
          phase: 'done',
          organizationId: owner.organizationId,
          scanFor: ['services', 'team'],
          result: {
            services: [
              { name: 'Readable Service', priceType: 'fixed', priceAmount: 55 },
            ],
            targetAudienceDescription: 'people',
            brandVoice: ['warm'],
            suggestedCredibilityLines: [],
            // Garbage where an array of staff belongs.
            practitioners: 'not-an-array',
          },
        }),
        'EX',
        600
      );

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);

      // The section that parsed lands...
      const services = await readServices(owner.organizationId);
      expect(services.map((s) => s.name)).toEqual(['Readable Service']);
      // ...and the one that did not is simply absent, not fatal.
      await expect(
        readPractitioners(owner.organizationId)
      ).resolves.toHaveLength(0);
    });

    it('is a no-op, not an error, when the account already matches the site', async () => {
      const owner = await actAsFreshOwner();
      await seedExistingService({
        organizationId: owner.organizationId,
        name: 'Only Service',
        priceType: 'fixed',
        priceCents: 5000,
      });
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        scanFor: ['services'],
        result: anAnalysis({
          services: [
            { name: 'Only Service', priceType: 'fixed', priceAmount: 50 },
          ],
        }),
      });

      const previewed = await preview(jobId);
      expect(previewed.body.services.create).toEqual([]);
      expect(previewed.body.services.priceChanges).toEqual([]);
      expect(previewed.body.services.unchanged).toBe(1);

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);
      expect(applied.body.skipped).toEqual([]);
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(1);
    });

    it('leaves the account untouched when preview is called', async () => {
      // The panel calls preview on every open. It must be a pure read.
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        result: anAnalysis({
          services: [
            { name: 'Would Be Created', priceType: 'fixed', priceAmount: 10 },
          ],
          practitioners: [{ name: 'Would Be Hired' }],
          locations: [
            { addressLine1: '1 Would Be Road', city: 'Dublin', country: 'ie' },
          ],
          businessHours: { '1': { from: 540, to: 1020 } },
          primaryColor: '#123456',
        }),
      });

      // Snapshot the org BEFORE: several of these columns carry DB defaults
      // (primaryColor seeds to '#6366f1'), so "still null" would be the wrong
      // assertion — "still exactly what it was" is the right one.
      const before = await readOrg(owner.organizationId);

      expect((await preview(jobId)).status).toBe(CREATED);
      expect((await preview(jobId)).status).toBe(CREATED);

      await expect(readServices(owner.organizationId)).resolves.toHaveLength(0);
      await expect(
        readPractitioners(owner.organizationId)
      ).resolves.toHaveLength(0);
      await expect(readLocations(owner.organizationId)).resolves.toHaveLength(
        0
      );

      const after = await readOrg(owner.organizationId);
      expect(after.primaryColor).toBe(before.primaryColor);
      expect(after.secondaryColor).toBe(before.secondaryColor);
      expect(after.logo).toBe(before.logo);
      expect(after.businessHours).toEqual(before.businessHours);
    });
  });

  /* ================================================================== */
  /* N. Full-scan round trip                                             */
  /* ================================================================== */

  describe('full scan', () => {
    it('writes every section of a complete scan into an empty account', async () => {
      const owner = await actAsFreshOwner();
      const jobId = await seedJob({
        organizationId: owner.organizationId,
        result: anAnalysis({
          businessDescription: 'A bright clinic on the quays.',
          services: [
            { name: 'Laser Session', priceType: 'fixed', priceAmount: 100 },
            { name: 'Aftercare Facial', priceType: 'from', priceAmount: 40 },
          ],
          packages: [
            {
              name: 'Laser Course',
              priceAmount: 500,
              serviceNames: ['Laser Session'],
              validityDays: 180,
            },
          ],
          practitioners: [
            { name: 'Dr Aoife Byrne', title: 'Lead Clinician' },
            { name: 'Mark Ryan', email: 'mark@clinic.ie' },
          ],
          locations: [
            {
              name: 'Quay Clinic',
              addressLine1: '5 Ormond Quay',
              city: 'Dublin',
              country: 'ie',
            },
          ],
          businessHours: { '1': { from: 540, to: 1020 } },
          primaryColor: '#0f172a',
        }),
      });

      const previewed = await preview(jobId);
      expect(previewed.status).toBe(CREATED);

      const applied = await apply(jobId);
      expect(applied.status).toBe(CREATED);
      expect(applied.body.skipped).toEqual([]);
      expect(applied.body).toEqual(
        expect.objectContaining({
          servicesPriceUpdated: 0,
          servicesDeactivated: 0,
          locationsCreated: 1,
          venueDescriptionUpdated: true,
          openingHoursUpdated: true,
          brandUpdated: true,
          practitionersCreated: 2,
          practitionersDeactivated: 0,
          packagesCreated: 1,
          packagesDeactivated: 0,
        })
      );
      expect(applied.body.createdServiceIds).toHaveLength(2);

      // Read every one of them back out of Postgres.
      await expect(readServices(owner.organizationId)).resolves.toHaveLength(2);
      await expect(
        readPractitioners(owner.organizationId)
      ).resolves.toHaveLength(2);
      await expect(readPackages(owner.organizationId)).resolves.toHaveLength(1);

      const [location] = await readLocations(owner.organizationId);
      expect(location.about).toBe('A bright clinic on the quays.');
      expect(location.isPrimary).toBe(true);

      const org = await readOrg(owner.organizationId);
      expect(org.primaryColor).toBe('#0f172a');
      expect(org.businessHours).toEqual({ '1': { from: 540, to: 1020 } });

      // A second full scan of the same site changes nothing.
      const again = await apply(jobId);
      expect(again.body.createdServiceIds).toEqual([]);
      expect(again.body.practitionersCreated).toBe(0);
      expect(again.body.packagesCreated).toBe(0);
      expect(again.body.locationsCreated).toBe(0);
    });
  });
});
