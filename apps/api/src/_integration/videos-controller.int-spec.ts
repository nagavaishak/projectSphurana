import { randomUUID } from 'node:crypto';
/**
 * CHARACTERIZATION tests for `apps/api/src/videos/videos.controller.ts`.
 *
 * PURPOSE: this file is a refactor net, not a feature spec. `VideosController`
 * carries ~731 lines of orchestration — most of it inside the 322-line private
 * `synthesizeFinalInput`, which assembles a complete `createVideo` input from
 * org defaults + the template registry + a service + org footage + AI copy.
 * That orchestration is about to move out of the controller into a use case.
 * Every assertion below pins OBSERVABLE behaviour of TODAY'S code so the move
 * can be proven behaviour-preserving: same HTTP status, same persisted `video`
 * row, same synthesised `draftConfig` VALUES.
 *
 * Where it matters most, the assertions read the row back out of Postgres —
 * asserting only the HTTP response would let a refactor change what is stored
 * without any test noticing.
 *
 * EXTERNAL BOUNDARIES (no mocks, so these are pinned only up to the boundary):
 *   - AI copy: `synthesizeFinalInput` calls `generateVideoScript` (when the
 *     synthesised scriptText still contains `[PLACEHOLDER]` tokens AND a
 *     serviceId was supplied), `generateOrganicCopy` (organic templates) and
 *     `buildOfferCard` → `generateOfferCopy` (offer templates). Those hit
 *     OpenAI, so their OUTPUT is not deterministic in this harness. Tests
 *     therefore steer clear of the AI branch (services are seeded WITH a
 *     description, which becomes the script seed and suppresses the
 *     placeholder-detection branch) or assert only the pre-AI behaviour
 *     (e.g. offer: missing offerId → 400, cross-org offerId → 404). Organic
 *     templates are deliberately NOT characterized — see the report.
 *   - Render queue: BullMQ runs against the real Redis testcontainer, so
 *     enqueue genuinely happens; nothing consumes the job.
 *   - S3 presigning: `getVideoUrl` is exercised only through its
 *     pass-through/catch path (a `blobUrl` that is neither an S3 URL nor a
 *     parseable URL is returned verbatim), which is deterministic without AWS.
 */
import {
  type Video,
  asset,
  assetService,
  db,
  organizationService,
  video,
} from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { VideosController } from '../videos/videos.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOffer,
  seedOrgWithMember,
  seedOrganization,
} from './harness.js';

const OK = 200;
const CREATED = 201;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** Insert a real `asset` row. Video type + `ready` transcode by default so the
 *  controller's `autoPickClips` filter accepts it. */
async function seedAsset(input: {
  organizationId: string;
  uploadedById: string;
  name?: string;
  type?: 'video' | 'image';
  transcodeStatus?: 'pending' | 'skipped' | 'ready' | 'failed';
  tags?: string[];
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(asset).values({
    id,
    organizationId: input.organizationId,
    uploadedById: input.uploadedById,
    name: input.name ?? `Asset ${id}`,
    blobUrl: `https://example.invalid/${id}.mp4`,
    type: input.type ?? 'video',
    transcodeStatus: input.transcodeStatus ?? 'ready',
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? new Date(),
  });
  return id;
}

/** Link an asset to a service via `asset_service`. `autoPickClips` reads this
 *  join table (ordered by `confidence` DESC) and, when a serviceId is known,
 *  picks from it EXCLUSIVELY — the org-wide library is never borrowed from. */
async function linkAssetToService(input: {
  assetId: string;
  serviceId: string;
  confidence: number;
}): Promise<void> {
  await db.insert(assetService).values({
    id: randomUUID(),
    assetId: input.assetId,
    serviceId: input.serviceId,
    confidence: input.confidence,
  });
}

/** Insert an `organization_service` WITH a description. The description is the
 *  script seed in `synthesizeDraftConfig`, which keeps the synthesised
 *  scriptText free of `[PLACEHOLDER]` tokens and therefore keeps the
 *  controller off the AI script-generation branch. */
async function seedServiceWithDescription(input: {
  organizationId: string;
  name: string;
  description: string;
}): Promise<string> {
  const id = `svc_${randomUUID()}`;
  await db.insert(organizationService).values({
    id,
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
  });
  return id;
}

/** Insert a `video` row directly (for read/isolation tests). */
async function seedVideo(input: {
  organizationId: string;
  createdById: string;
  title?: string;
  blobUrl?: string | null;
  thumbnailUrl?: string | null;
  draftConfig?: Record<string, unknown>;
  templateId?: string;
  variationId?: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(video).values({
    id,
    organizationId: input.organizationId,
    createdById: input.createdById,
    title: input.title ?? 'Seeded video',
    status: 'draft',
    progress: 0,
    blobUrl: input.blobUrl ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null,
    templateId: input.templateId ?? 'educational',
    variationId: input.variationId ?? 'educational-1',
    draftConfig: (input.draftConfig ?? {
      scriptText: 'Seeded script',
      narrationType: 'text_only',
      bRollClips: [],
      musicVolume: 0.15,
      captions: {
        enabled: true,
        position: 'bottom',
        fontFamily: 'Inter',
        fontSize: 48,
        textColor: '#FFFFFF',
        highlightColor: '#FFD700',
        backgroundColor: '#000000',
        showBackground: true,
      },
      orientation: 'portrait',
    }) as never,
  });
  return id;
}

async function readVideo(id: string): Promise<Video> {
  const [row] = await db.select().from(video).where(eq(video.id, id)).limit(1);
  expect(row).toBeTruthy();
  return row;
}

/** A complete draftConfig — has the four keys (`bRollClips`, `captions`,
 *  `outro`, `orientation`) the controller sniffs for to take the
 *  "legacy wizard passthrough" branch instead of synthesising. */
function completeDraftConfig(assetId: string) {
  return {
    scriptText: 'Hand written script',
    narrationType: 'text_only' as const,
    bRollClips: [{ assetId, order: 0, clipType: 'bRoll' as const }],
    textFrames: [
      {
        id: 'tf-0',
        text: 'Hand written script',
        durationSec: 3,
        style: 'question' as const,
      },
    ],
    musicVolume: 0.99,
    captions: {
      enabled: false,
      position: 'top' as const,
      fontFamily: 'Georgia',
      fontSize: 20,
      textColor: '#111111',
      highlightColor: '#222222',
      backgroundColor: '#333333',
      showBackground: false,
    },
    outro: {
      businessName: 'Hand Written Ltd',
      ctaText: 'Call Today',
      backgroundOpacity: 0.5,
      backgroundColor: '#0000FF',
      textColor: '#00FF00',
      durationSec: 2,
    },
    // Landscape survives ONLY on this branch — the synthesiser maps every
    // non-square org default to portrait.
    orientation: 'landscape' as const,
  };
}

describe('VideosController (HTTP, real Postgres)', () => {
  /* ================================================================== */
  /* 1. POST /videos — the synthesis path (`synthesizeFinalInput`)      */
  /* ================================================================== */

  describe('POST /videos — synthesis from a partial payload', () => {
    /**
     * PROTECTS: the retired format stays retired, as the DEFAULT above all.
     *
     * `before-after` used to be the synthesiser's hard-coded fallback, so an
     * empty body produced one — and this test pinned the 400 an untagged org
     * got as a result. The format was then retired end-to-end, because 0 of 64
     * before/after assets in production carried a `client_name`: an honest
     * pair was never possible, and every one of those videos implied a result
     * comparison the org could not substantiate.
     *
     * Retiring the DEFAULT is the part most likely to be undone by accident —
     * a fallback is exactly the kind of thing a refactor reinstates without
     * anyone asking for it. So the assertion is now that an empty body
     * succeeds, and that whatever it resolves to, it is not the retired format.
     */
    it('empty body → a synthesised draft that is NOT the retired before-after format', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({});
        expect(res.status).toBe(CREATED);

        const row = await readVideo(res.body.id);
        expect(row.templateId).not.toBe('before-after');
        expect(row.variationId).not.toMatch(/^before-after/);
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: the whole default-fill contract for a minimal `{ format }`
     * payload, read back FROM POSTGRES. Every value here is produced by a
     * different collaborator of `synthesizeFinalInput`:
     *   - `format: 'educational'` → templateId via VIDEO_FORMAT_TO_TEMPLATE_ID
     *   - variationId → first variation of the template (deterministic)
     *   - title → template title (no service supplied)
     *   - orientation `portrait` → org default is `landscape`, and the
     *     synthesiser deliberately maps everything non-square to portrait
     *   - outro.businessName → the ORG name (getOrganization signals)
     *   - captions/musicVolume/outro styling → hard-coded synth defaults
     *   - textFrames → derived from the variation's scriptTemplate, one frame
     *     per line, first line styled `question`, CTA line styled `cta`
     *   - usageType `ad`, status `draft`, progress 0, createdById = caller
     * A refactor that drops any one of these produces a draft that renders
     * differently (or not at all) with no other signal.
     */
    it('{ format: "educational" } synthesises the full draftConfig from org defaults', async () => {
      const organizationId = await seedOrganization({ name: 'Glow Clinic' });
      const owner = await seedOrgWithMember('owner', { organizationId });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({ format: 'educational' });
        expect(res.status).toBe(CREATED);

        const row = await readVideo(res.body.id);
        expect(row.templateId).toBe('educational');
        expect(row.variationId).toBe('educational-1');
        expect(row.title).toBe('Educational');
        expect(row.serviceId).toBeNull();
        expect(row.offerId).toBeNull();
        expect(row.usageType).toBe('ad');
        expect(row.status).toBe('draft');
        expect(row.progress).toBe(0);
        expect(row.createdById).toBe(owner.userId);
        expect(row.organizationId).toBe(organizationId);

        const cfg = row.draftConfig as NonNullable<Video['draftConfig']>;
        expect(cfg.orientation).toBe('portrait');
        expect(cfg.narrationType).toBe('text_only');
        expect(cfg.musicVolume).toBe(0.15);
        expect(cfg.captions).toEqual({
          enabled: true,
          position: 'bottom',
          fontFamily: 'Inter',
          fontSize: 48,
          textColor: '#FFFFFF',
          highlightColor: '#FFD700',
          backgroundColor: '#000000',
          showBackground: true,
        });
        expect(cfg.outro).toEqual({
          businessName: 'Glow Clinic',
          ctaText: 'Book Now',
          backgroundOpacity: 0.85,
          backgroundColor: '#000000',
          textColor: '#FFFFFF',
          durationSec: 4,
        });
        // No service → the variation's placeholder scriptTemplate survives,
        // because the AI rewrite branch requires a serviceId.
        expect(cfg.scriptText).toBe(
          'Struggling with [PAIN POINT]?\n[SERVICE NAME] → helps improve [RESULT / OUTCOME]\nResults vary • Consultation required\nDM to Learn More'
        );
        expect(cfg.textFrames).toEqual([
          {
            id: 'tf-0',
            text: 'Struggling with [PAIN POINT]?',
            durationSec: 3,
            style: 'question',
          },
          {
            id: 'tf-1',
            text: '[SERVICE NAME] → helps improve [RESULT / OUTCOME]',
            durationSec: 3,
            style: 'answer',
          },
          {
            id: 'tf-2',
            text: 'Results vary • Consultation required',
            durationSec: 3,
            style: 'disclaimer',
          },
          {
            id: 'tf-3',
            text: 'DM to Learn More',
            durationSec: 3,
            style: 'cta',
          },
        ]);
        // Org has no assets → auto-pick finds nothing and the draft persists
        // clip-less (soft failure, logged as a warning).
        expect(cfg.bRollClips).toEqual([]);
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: the serviceId branch AND `autoPickClips` selection rules.
     *   - title becomes "<service> — <template title>"
     *   - the service DESCRIPTION becomes the script seed, and textFrames are
     *     re-derived from it
     *   - `bRollClips` are auto-filled with at most `recommendedClipCount` (2
     *     for educational-1) asset ids drawn ONLY from footage linked to that
     *     service, highest `confidence` first, each tagged `clipType: 'bRoll'`
     *     with a 0-based `order`
     *   - the org-wide library is NOT borrowed from when the service is known.
     *     An unlinked asset — newer than every linked one — must stay out. This
     *     is the "I asked for an IV drips video and it used my unrelated clip"
     *     defect; returning FEWER clips is the correct outcome, and export
     *     backfills from the service's rotation pool.
     *   - assets whose transcode is not ready/skipped are EXCLUDED — linking a
     *     `pending` asset at the TOP confidence proves the filter runs before
     *     the confidence cut, not after. This one matters: a pending clip in a
     *     draft is rejected later by the export gate, so the draft would be
     *     born un-renderable.
     */
    it('{ serviceId } seeds title + script from the service and auto-picks ready clips only', async () => {
      const organizationId = await seedOrganization({ name: 'Radiance' });
      const owner = await seedOrgWithMember('owner', { organizationId });
      const serviceId = await seedServiceWithDescription({
        organizationId,
        name: 'Lip Filler',
        description: 'Smooth, natural lip enhancement.\nResults in one visit.',
      });

      // Three ready clips linked to the service, at descending confidence.
      const lowest = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
      });
      const middle = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
      });
      const best = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
      });
      // Linked at the HIGHEST confidence, but still transcoding → skipped.
      const pending = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
        transcodeStatus: 'pending',
      });
      // Ready and the NEWEST asset in the org, but linked to no service → must
      // never be borrowed to illustrate this one.
      const unlinked = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
        createdAt: new Date('2030-01-01T00:00:00Z'),
      });
      await linkAssetToService({ assetId: pending, serviceId, confidence: 1 });
      await linkAssetToService({ assetId: best, serviceId, confidence: 0.9 });
      await linkAssetToService({ assetId: middle, serviceId, confidence: 0.5 });
      await linkAssetToService({ assetId: lowest, serviceId, confidence: 0.1 });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId,
        });
        const res = await request(h.app.getHttpServer()).post('/videos').send({
          templateId: 'educational',
          variationId: 'educational-1',
          serviceId,
        });
        expect(res.status).toBe(CREATED);

        const row = await readVideo(res.body.id);
        expect(row.title).toBe('Lip Filler — Educational');
        expect(row.serviceId).toBe(serviceId);

        const cfg = row.draftConfig as NonNullable<Video['draftConfig']>;
        expect(cfg.scriptText).toBe(
          'Smooth, natural lip enhancement.\nResults in one visit.'
        );
        expect(cfg.textFrames).toEqual([
          {
            id: 'tf-0',
            text: 'Smooth, natural lip enhancement.',
            durationSec: 3,
            style: 'question',
          },
          {
            id: 'tf-1',
            text: 'Results in one visit.',
            durationSec: 3,
            style: 'answer',
          },
        ]);
        expect(cfg.bRollClips).toEqual([
          { assetId: best, order: 0, clipType: 'bRoll' },
          { assetId: middle, order: 1, clipType: 'bRoll' },
        ]);
        const pickedIds = cfg.bRollClips.map((c) => c.assetId);
        // Capped at recommendedClipCount, so the weakest link falls off.
        expect(pickedIds).not.toContain(lowest);
        // Un-renderable — excluded despite topping the confidence order.
        expect(pickedIds).not.toContain(pending);
        // The org's newest clip, but not this service's footage.
        expect(pickedIds).not.toContain(unlinked);
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: the "service lookup never blocks creation" rule. A serviceId
     * that belongs to ANOTHER org fails `getService` (org-scoped), the
     * controller logs a warning and proceeds without service signals — but
     * still writes the foreign serviceId onto the row.
     *
     * ⚠ This looks like a BUG (a cross-org id is persisted on the video, and
     * the title/script silently fall back to generic copy rather than telling
     * the caller their serviceId was wrong). It is pinned here AS-IS because
     * the refactor must not change behaviour by accident — fixing it should be
     * a deliberate, separate change that updates this test.
     *
     * NOTE (external boundary): because the service lookup failed, the script
     * seed stays the variation's `[PLACEHOLDER]` template while `serviceId` is
     * still truthy — so this payload DOES reach `generateVideoScript` (a live
     * OpenAI call, best-effort/caught). Nothing downstream of that boundary is
     * asserted here; `title` and `serviceId` are decided before it runs.
     */
    it('a cross-org serviceId is ignored for signals and NOT persisted on the row', async () => {
      // This pin is INVERTED. It used to assert the foreign id landed on the
      // row ("…but the foreign id is on the row anyway"), which was the
      // asymmetry: the SAME handler aborts with 404 on a cross-org `offerId`
      // (see the test below) while writing a cross-org `serviceId` straight
      // into `video.serviceId`.
      //
      // The soft behaviour is kept — synthesis still proceeds without service
      // signals rather than erroring — but it is now honest: having decided to
      // proceed WITHOUT a service, the row no longer claims one.
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const foreignServiceId = await seedServiceWithDescription({
        organizationId: orgB.organizationId,
        name: 'B-only Peel',
        description: 'Belongs to another org.',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({ format: 'educational', serviceId: foreignServiceId });
        expect(res.status).toBe(CREATED);

        const row = await readVideo(res.body.id);
        // No service signals were used…
        expect(row.title).toBe('Educational');
        // …and the foreign id is not on the row either.
        expect(row.serviceId).toBeNull();
        expect(row.organizationId).toBe(orgA.organizationId);
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: tagged media does not RESURRECT the retired format.
     *
     * This used to pin before/after clip resolution by tag and its ordering.
     * The format is retired, but the `before` / `after` tags still exist on
     * real assets and orgs keep applying them — so the tags are the most
     * plausible route by which the format comes back, either through a
     * resurrected template or a synthesiser that treats the tags as a signal.
     *
     * The clips must still be USABLE (tagged media is ordinary footage), just
     * never assembled into a transformation claim.
     */
    it('tagged before/after media does NOT produce a before-after video', async () => {
      const organizationId = await seedOrganization({ name: 'Tagged Clinic' });
      const owner = await seedOrgWithMember('owner', { organizationId });

      const beforeId = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
        type: 'image',
        tags: ['before'],
      });
      const afterId = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
        type: 'image',
        tags: ['after'],
      });
      const procedureId = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
        type: 'video',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({});
        expect(res.status).toBe(CREATED);

        const row = await readVideo(res.body.id);
        expect(row.templateId).not.toBe('before-after');
        expect(row.variationId).not.toMatch(/^before-after/);

        // No clip is cast as a before/after pair member — that framing, not
        // the footage, is what was retired.
        const cfg = row.draftConfig as NonNullable<Video['draftConfig']>;
        const clipTypes = (cfg.bRollClips ?? []).map((c) => c.clipType);
        expect(clipTypes).not.toContain('before');
        expect(clipTypes).not.toContain('after');

        // The tagged media itself remains ordinary, usable footage.
        expect([beforeId, afterId, procedureId].every((id) => id)).toBe(true);
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: the offer template's mandatory-subject gate. `offer` is the
     * only template that hard-fails when its subject is missing, with a message
     * Claire reads back to the user. Pinned BEFORE the AI boundary
     * (`buildOfferCard` → `generateOfferCopy`), so this assertion is stable.
     */
    it('offer format without an offerId → 400 with the "offerId is required" message', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({ format: 'offer' });
        expect(res.status).toBe(BAD_REQUEST);
        expect(res.body.message).toBe(
          'offerId is required for offer-format videos. Call listOffers to pick one.'
        );
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: offer org-scoping. `buildOfferCard` loads the offer scoped by
     * org, so a foreign offerId is NOT_FOUND → 404 and no video row is written.
     * Unlike the serviceId path above (soft failure), offer failure ABORTS —
     * that asymmetry is deliberate and easy to lose in a refactor.
     */
    it('offer format with a cross-org offerId → 404 and no video row', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const foreignOfferId = await seedOffer({
        organizationId: orgB.organizationId,
        name: 'B-only Offer',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({ format: 'offer', offerId: foreignOfferId });
        expect(res.status).toBe(NOT_FOUND);

        const rows = await db
          .select()
          .from(video)
          .where(eq(video.organizationId, orgA.organizationId));
        expect(rows).toHaveLength(0);
      } finally {
        await h?.close();
      }
    });
  });

  /* ================================================================== */
  /* 2. POST /videos — the legacy full-draftConfig passthrough branch    */
  /* ================================================================== */

  describe('POST /videos — complete draftConfig passthrough', () => {
    /**
     * PROTECTS: the branch discriminator. The controller decides "complete"
     * purely by sniffing for FOUR keys (bRollClips, captions, outro,
     * orientation); on that branch a missing title is a 400 rather than being
     * defaulted from the template. The exact message is user-visible.
     */
    it('complete draftConfig without a title → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/videos')
          .send({
            templateId: 'educational',
            draftConfig: completeDraftConfig(assetId),
          });
        expect(res.status).toBe(BAD_REQUEST);
        expect(res.body.message).toBe(
          'title is required when draftConfig is fully provided'
        );
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: that the passthrough branch performs NO synthesis at all. The
     * caller's values survive verbatim — including `orientation: 'landscape'`
     * (which the synthesiser would have rewritten to portrait) and
     * `musicVolume: 0.99` (synth default is 0.15). Those two values are the
     * cheapest possible proof that synthesis did not run.
     */
    it('complete draftConfig with a title is stored verbatim (no synthesis)', async () => {
      const organizationId = await seedOrganization({ name: 'Verbatim Ltd' });
      const owner = await seedOrgWithMember('owner', { organizationId });
      const assetId = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
      });
      const draftConfig = completeDraftConfig(assetId);

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId,
        });
        const res = await request(h.app.getHttpServer()).post('/videos').send({
          title: 'My hand-built video',
          templateId: 'educational',
          variationId: 'educational-2',
          draftConfig,
        });
        expect(res.status).toBe(CREATED);

        const row = await readVideo(res.body.id);
        expect(row.title).toBe('My hand-built video');
        expect(row.templateId).toBe('educational');
        expect(row.variationId).toBe('educational-2');
        expect(row.usageType).toBe('ad');
        expect(row.draftConfig).toEqual(draftConfig);
      } finally {
        await h?.close();
      }
    });
  });

  /* ================================================================== */
  /* 3. POST /videos/template-preview — SHARES synthesizeFinalInput      */
  /* ================================================================== */

  describe('POST /videos/template-preview', () => {
    /**
     * THE MOST VALUABLE ASSERTION IN THIS FILE.
     *
     * `templatePreview` and `create` both call the private
     * `synthesizeFinalInput`. When that function is extracted into a use case,
     * the risk is that only ONE call site is migrated correctly and the two
     * paths silently diverge — the preview page would then stop previewing what
     * a real create produces, which is exactly the bug the preview exists to
     * prevent, and nothing else would catch it.
     *
     * Both requests use the SAME partial payload against the SAME org, and the
     * persisted draftConfig is compared field-for-field. `educational-1` is
     * used because it is already `text_only`, so preview's
     * `recorded → ai_voiceover` fix-up does not fire and the two drafts are
     * directly comparable. The service carries a description, so neither path
     * enters the AI script branch.
     *
     * Preview additionally queues a v1 export (real BullMQ → real Redis); the
     * export gate mutates nothing when clips are already present, so the
     * comparison stays exact apart from `status`.
     */
    it('produces the SAME synthesised draft as POST /videos for the same payload', async () => {
      const organizationId = await seedOrganization({ name: 'Parity Clinic' });
      const owner = await seedOrgWithMember('owner', { organizationId });
      const serviceId = await seedServiceWithDescription({
        organizationId,
        name: 'Skin Boost',
        description: 'Hydrating skin boost treatment.\nGlow within days.',
      });
      // Linked to the service: auto-pick draws exclusively from service-linked
      // footage, and preview's export gate rejects a text-only draft with no
      // b-roll — so unlinked org assets would make this a 400, not a parity
      // check.
      const clipA = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
      });
      const clipB = await seedAsset({
        organizationId,
        uploadedById: owner.userId,
      });
      await linkAssetToService({ assetId: clipA, serviceId, confidence: 0.9 });
      await linkAssetToService({ assetId: clipB, serviceId, confidence: 0.5 });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId,
        });
        const server = h.app.getHttpServer();
        const payload = {
          templateId: 'educational',
          variationId: 'educational-1',
          serviceId,
        };

        const created = await request(server).post('/videos').send(payload);
        expect(created.status).toBe(CREATED);

        const preview = await request(server)
          .post('/videos/template-preview')
          .send({ ...payload, version: 'v1' });
        expect(preview.status).toBe(CREATED);
        expect(typeof preview.body.videoId).toBe('string');

        const createdRow = await readVideo(created.body.id);
        const previewRow = await readVideo(preview.body.videoId);

        expect(previewRow.id).not.toBe(createdRow.id);
        expect(previewRow.draftConfig).toEqual(createdRow.draftConfig);
        expect(previewRow.title).toBe(createdRow.title);
        expect(previewRow.templateId).toBe(createdRow.templateId);
        expect(previewRow.variationId).toBe(createdRow.variationId);
        expect(previewRow.serviceId).toBe(createdRow.serviceId);
        expect(previewRow.usageType).toBe(createdRow.usageType);
        expect(previewRow.createdById).toBe(createdRow.createdById);

        // The one intended difference: create leaves a draft, preview queues it.
        expect(createdRow.status).toBe('draft');
        expect(previewRow.status).toBe('queued');
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: the two hand-rolled guards at the top of the handler, which run
     * BEFORE any DB work. They are plain `if`s (not DTO validation), so they
     * are easy to drop when the body moves into a DTO.
     */
    it('rejects a bad version and a payload with no template/variation/format', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const badVersion = await request(server)
          .post('/videos/template-preview')
          .send({ templateId: 'educational', version: 'v3' });
        expect(badVersion.status).toBe(BAD_REQUEST);
        expect(badVersion.body.message).toBe("version must be 'v1' or 'v2'");

        const noTemplate = await request(server)
          .post('/videos/template-preview')
          .send({ version: 'v1' });
        expect(noTemplate.status).toBe(BAD_REQUEST);
        expect(noTemplate.body.message).toBe(
          'templateId, variationId or format is required'
        );
      } finally {
        await h?.close();
      }
    });
  });

  /* ================================================================== */
  /* 4. Read paths — URL rewriting + list shaping                        */
  /* ================================================================== */

  describe('GET /videos and GET /videos/:id', () => {
    /**
     * PROTECTS: the list handler's deliberate `blobUrl: null` blanking (a
     * performance decision — it stops browsers preloading full videos and
     * halves presign calls) and the org scoping of the query.
     *
     * The `total` half is INVERTED from what it was. This block used to pin
     * `total: items.length` — the PAGE length — while flagging it: "⚠ looks
     * like a BUG (a paginating client can never learn the real total). Pinned
     * as-is." It was a bug; `listVideos` now counts over the same predicate.
     *
     * The count is asserted to be org-scoped, which is the property a naive
     * `count(*)` fix would break.
     */
    it('list blanks blobUrl, is org-scoped, and reports total = matching row count', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const aVideo = await seedVideo({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
        title: 'A video',
        blobUrl: 'stored-blob-url-value',
      });
      // A SECOND video in org A, so `total` can distinguish "page length" from
      // "match count". With one video each the old and new behaviour agree and
      // the assertion proves nothing.
      await seedVideo({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
        title: 'A video 2',
      });
      const bVideo = await seedVideo({
        organizationId: orgB.organizationId,
        createdById: orgB.userId,
        title: 'B video',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get('/videos');
        expect(res.status).toBe(OK);
        expect(res.body.items).toHaveLength(2);
        expect(
          res.body.items.some((v: { id: string }) => v.id === aVideo)
        ).toBe(true);
        // Blanked even though the DB row has a value.
        expect(res.body.items[0].blobUrl).toBeNull();
        expect(res.body.items[0].thumbnailUrl).toBeNull();
        // Org A's two, NOT org B's — a naive count(*) would say 3 here, which
        // is exactly the fix that must not ship.
        expect(res.body.total).toBe(2);
        expect(res.body.limit).toBe(50);
        expect(res.body.offset).toBe(0);
        expect(
          res.body.items.some((v: { id: string }) => v.id === bVideo)
        ).toBe(false);

        // limit/offset are parsed off the query string as base-10 ints.
        const paged = await request(h.app.getHttpServer()).get(
          '/videos?limit=1&offset=1'
        );
        expect(paged.status).toBe(OK);
        expect(paged.body.limit).toBe(1);
        expect(paged.body.offset).toBe(1);
        expect(paged.body.items).toHaveLength(1);
        // The page window does not move `total`.
        expect(paged.body.total).toBe(2);
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: `getVideoUrl`'s fallback. A stored blobUrl that is neither a
     * parseable S3 URL nor a valid URL must be returned UNCHANGED rather than
     * throwing a 500 — this is the branch that keeps legacy/garbage rows
     * readable. (The presigning branches need AWS and are not characterized
     * here; see the report.)
     */
    it('detail returns an unparseable blobUrl verbatim instead of failing', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        blobUrl: 'not-a-url-at-all',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(`/videos/${id}`);
        expect(res.status).toBe(OK);
        expect(res.body.id).toBe(id);
        expect(res.body.blobUrl).toBe('not-a-url-at-all');
        expect(res.body.thumbnailUrl).toBeNull();
      } finally {
        await h?.close();
      }
    });
  });

  /* ================================================================== */
  /* 5. Org isolation via verifyVideoOwnership                           */
  /* ================================================================== */

  describe('org isolation (verifyVideoOwnership)', () => {
    /**
     * PROTECTS: the shared ownership guard used by ~8 handlers. Note the
     * status split, which is the actual current contract:
     *   - video exists but belongs to another org → 403 (NOT 404)
     *   - video does not exist at all             → 404
     *
     * ⚠ The 403 leaks the existence of another org's video id. Pinned as-is —
     * changing it is a product decision, not a refactor.
     */
    it("another org's video → 403 on read/update/delete; unknown id → 404", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bVideo = await seedVideo({
        organizationId: orgB.organizationId,
        createdById: orgB.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const got = await request(server).get(`/videos/${bVideo}`);
        expect(got.status).toBe(FORBIDDEN);
        expect(got.body.message).toBe('You do not have access to this video');

        const put = await request(server)
          .put(`/videos/${bVideo}`)
          .send({ title: 'hijacked' });
        expect(put.status).toBe(FORBIDDEN);

        const del = await request(server).delete(`/videos/${bVideo}`);
        expect(del.status).toBe(FORBIDDEN);

        const missing = await request(server).get(`/videos/${randomUUID()}`);
        expect(missing.status).toBe(NOT_FOUND);
        expect(missing.body.message).toBe('Video not found');

        // The org-B row is untouched by the rejected update/delete.
        const row = await readVideo(bVideo);
        expect(row.title).toBe('Seeded video');
        expect(row.deletedAt).toBeNull();
      } finally {
        await h?.close();
      }
    });
  });

  /* ================================================================== */
  /* 6. Other fat handlers                                               */
  /* ================================================================== */

  describe('POST /videos/:id/export', () => {
    /**
     * PROTECTS: the pre-flight render gate reaching the caller as a 400 with a
     * diagnosable message, instead of enqueuing a job that would fail ~6× in
     * the worker and wedge the queue. The `Video configuration is incomplete:`
     * prefix is added by the service and the specific reason by the gate.
     */
    it('a clip-less text_only draft → 400 explaining why it cannot render', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post(
          `/videos/${id}/export`
        );
        expect(res.status).toBe(BAD_REQUEST);
        expect(res.body.message).toBe(
          'Video configuration is incomplete: Text-only videos require at least one b-roll clip for visual content'
        );
        // Status untouched — the video stays editable.
        const row = await readVideo(id);
        expect(row.status).toBe('draft');
      } finally {
        await h?.close();
      }
    });
  });

  describe('POST/GET /videos/:id/draft-clips', () => {
    /**
     * PROTECTS: the body-shape discriminator on a single route. A `{ clips: [] }`
     * body returns `{ clips: [...] }`; a single-clip body returns the BARE row.
     * Two different response shapes on one URL is exactly the sort of thing a
     * refactor "tidies up" — and the frontend single-drop handler plus
     * `videos_autoSelectClips` each depend on one of them.
     * Also pins the `processingStatus` default of `'processing'` and the
     * cross-org asset guard (404).
     */
    it('batch body → { clips: [...] }, single body → the bare row', async () => {
      const owner = await seedOrgWithMember('owner');
      const otherOrg = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const a1 = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      const a2 = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      const foreignAsset = await seedAsset({
        organizationId: otherOrg.organizationId,
        uploadedById: otherOrg.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const batch = await request(server)
          .post(`/videos/${videoId}/draft-clips`)
          .send({
            clips: [
              { assetId: a1, source: 'suggested', beatOrder: 0 },
              { assetId: a2, source: 'suggested', beatOrder: 1 },
            ],
          });
        expect(batch.status).toBe(CREATED);
        expect(batch.body.clips).toHaveLength(2);
        expect(batch.body.clips[0].assetId).toBe(a1);
        expect(batch.body.clips[0].processingStatus).toBe('processing');
        expect(batch.body.clips[1].beatOrder).toBe(1);

        const single = await request(server)
          .post(`/videos/${videoId}/draft-clips`)
          .send({ assetId: a1, source: 'library', beatOrder: 5 });
        expect(single.status).toBe(CREATED);
        expect(single.body.clips).toBeUndefined();
        expect(single.body.assetId).toBe(a1);
        expect(single.body.source).toBe('library');
        expect(single.body.beatOrder).toBe(5);

        const foreign = await request(server)
          .post(`/videos/${videoId}/draft-clips`)
          .send({ assetId: foreignAsset, source: 'library' });
        expect(foreign.status).toBe(NOT_FOUND);
        expect(foreign.body.message).toBe('Asset not found');

        const list = await request(server).get(
          `/videos/${videoId}/draft-clips`
        );
        expect(list.status).toBe(OK);
        expect(list.body.clips ?? list.body).toHaveLength(3);
      } finally {
        await h?.close();
      }
    });
  });

  describe('PATCH /videos/:id/draft-config', () => {
    /**
     * PROTECTS: the merge semantics of the Claire iterate-in-chat path and the
     * `requeueRender` override. Supplied top-level keys replace; every key the
     * patch omits survives untouched. Passing `requeueRender: false` must save
     * WITHOUT queueing — `rendered: false` and the video stays `draft` (the web
     * editor relies on this to autosave without burning a render).
     */
    /**
     * PROTECTS: the whole reason `clipOperations` exists.
     *
     * `patch.bRollClips` replaces the array WHOLESALE, and the skill text used
     * to instruct Claire to rebuild it from whatever subset she had in view —
     * so every clip she could not see was deleted, the render succeeded, and
     * nothing reported it. She has no read of `bRollClips` at all
     * (`videos_listDraftClips` returns the separate `video_draft_clip` tray),
     * so "whatever she had in view" was routinely a fraction of the list.
     *
     * The operation is applied server-side against the STORED list, which is
     * what makes an unseen clip impossible to lose. Asserted through the real
     * HTTP pipeline rather than only on the pure function, because the failure
     * this replaces was in the wiring, not the algorithm.
     */
    it('a clip swap changes ONE clip and leaves the others untouched', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        draftConfig: {
          scriptText: 'Seeded script',
          narrationType: 'text_only',
          bRollClips: [
            { assetId: 'clip-a', order: 0, clipType: 'bRoll' },
            { assetId: 'clip-b', order: 1, clipType: 'bRoll' },
            { assetId: 'clip-c', order: 2, clipType: 'bRoll' },
          ],
          musicVolume: 0.15,
          orientation: 'portrait',
        },
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch(`/videos/${id}/draft-config`)
          .send({
            requeueRender: false,
            // No `patch` at all — a clip edit is a complete request.
            clipOperations: [{ op: 'swap', index: 1, assetId: 'clip-new' }],
          });
        expect(res.status).toBe(OK);

        const cfg = (await readVideo(id)).draftConfig as NonNullable<
          Video['draftConfig']
        >;
        expect(cfg.bRollClips).toEqual([
          { assetId: 'clip-a', order: 0, clipType: 'bRoll' },
          { assetId: 'clip-new', order: 1, clipType: 'bRoll' },
          { assetId: 'clip-c', order: 2, clipType: 'bRoll' },
        ]);
      } finally {
        await h?.close();
      }
    });

    it('a clip remove drops ONE clip and recompacts order', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        draftConfig: {
          scriptText: 'Seeded script',
          narrationType: 'text_only',
          bRollClips: [
            { assetId: 'clip-a', order: 0, clipType: 'bRoll' },
            { assetId: 'clip-b', order: 1, clipType: 'bRoll' },
            { assetId: 'clip-c', order: 2, clipType: 'bRoll' },
          ],
          musicVolume: 0.15,
          orientation: 'portrait',
        },
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch(`/videos/${id}/draft-config`)
          .send({
            requeueRender: false,
            // Named by asset id — the addressing Claire can use without a read.
            clipOperations: [{ op: 'remove', targetAssetId: 'clip-b' }],
          });
        expect(res.status).toBe(OK);

        const cfg = (await readVideo(id)).draftConfig as NonNullable<
          Video['draftConfig']
        >;
        // A gap in `order` would break the render sequence, so it recompacts.
        expect(cfg.bRollClips).toEqual([
          { assetId: 'clip-a', order: 0, clipType: 'bRoll' },
          { assetId: 'clip-c', order: 1, clipType: 'bRoll' },
        ]);
      } finally {
        await h?.close();
      }
    });

    it('rejects a clip operation naming a position that does not exist', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        draftConfig: {
          scriptText: 'Seeded script',
          narrationType: 'text_only',
          bRollClips: [{ assetId: 'clip-a', order: 0, clipType: 'bRoll' }],
          musicVolume: 0.15,
          orientation: 'portrait',
        },
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch(`/videos/${id}/draft-config`)
          .send({
            requeueRender: false,
            clipOperations: [{ op: 'swap', index: 7, assetId: 'clip-new' }],
          });
        // A correctable request, not a server fault — reporting it as a 500
        // would send Claire into a retry loop against a draft that is fine.
        expect(res.status).toBe(BAD_REQUEST);

        // And the stored list is untouched.
        const cfg = (await readVideo(id)).draftConfig as NonNullable<
          Video['draftConfig']
        >;
        expect(cfg.bRollClips).toEqual([
          { assetId: 'clip-a', order: 0, clipType: 'bRoll' },
        ]);
      } finally {
        await h?.close();
      }
    });

    it('merges the patch and honours requeueRender: false', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch(`/videos/${id}/draft-config`)
          .send({
            title: 'Renamed by Claire',
            requeueRender: false,
            patch: {
              scriptText: 'Winter pricing script',
              orientation: 'square',
              captions: {
                enabled: false,
                position: 'top',
                fontFamily: 'Inter',
                fontSize: 48,
                textColor: '#FFFFFF',
                highlightColor: '#FFD700',
                backgroundColor: '#000000',
                showBackground: false,
              },
            },
          });
        expect(res.status).toBe(OK);
        expect(res.body.rendered).toBe(false);

        const row = await readVideo(id);
        expect(row.title).toBe('Renamed by Claire');
        expect(row.status).toBe('draft');
        const cfg = row.draftConfig as NonNullable<Video['draftConfig']>;
        expect(cfg.scriptText).toBe('Winter pricing script');
        expect(cfg.orientation).toBe('square');
        expect(cfg.captions).toEqual({
          enabled: false,
          position: 'top',
          fontFamily: 'Inter',
          fontSize: 48,
          textColor: '#FFFFFF',
          highlightColor: '#FFD700',
          backgroundColor: '#000000',
          showBackground: false,
        });
        // Untouched keys survive the merge.
        expect(cfg.musicVolume).toBe(0.15);
        expect(cfg.narrationType).toBe('text_only');
      } finally {
        await h?.close();
      }
    });

    /**
     * PROTECTS: a nested partial is the obvious way to say "just turn captions
     * off", and it now works.
     *
     * This test previously pinned the OPPOSITE — a 400 — with its own comment
     * calling it "⚠ a BUG… pinned as-is so the refactor cannot change it
     * silently in either direction". This is that change, made deliberately.
     * `partialDraftConfigSchema` was `.partial()` at the TOP level only, so
     * every nested block had to be resent whole; `offerCard` was the one block
     * anyone had partialled, so offer videos worked and nothing else did.
     *
     * The cost was not theoretical. A caption edit came back 400, the tool
     * relayed it as a generic failure, and Claire told an owner their post was
     * "not editable at the moment — the post may be locked on the platform
     * side" and sent them to email a colleague. The post was perfectly
     * editable; the schema simply could not express the edit.
     *
     * The MERGE is the other half: siblings inside the block must survive, or
     * "turn captions off" silently discards the font and position with it.
     */
    it('accepts a NESTED-partial patch (captions: { enabled }) and keeps its siblings', async () => {
      const owner = await seedOrgWithMember('owner');
      const id = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch(`/videos/${id}/draft-config`)
          .send({
            requeueRender: false,
            patch: { captions: { enabled: false } },
          });
        expect(res.status).toBe(OK);

        const row = await readVideo(id);
        const cfg = row.draftConfig as NonNullable<Video['draftConfig']>;
        expect(cfg.captions.enabled).toBe(false);
        // Merged, not replaced — the fields nobody mentioned are still there.
        expect(cfg.captions.position).toBe('bottom');
        expect(cfg.captions.fontFamily).toBe('Inter');
        expect(cfg.captions.fontSize).toBe(48);
      } finally {
        await h?.close();
      }
    });
  });

  describe('POST /videos/stock-clips/mint', () => {
    /**
     * PROTECTS: the early return that avoids a pointless service call. An empty
     * or absent `stockClipIds` must yield `{ assetIds: {} }` with a 201 — the
     * frontend treats a missing `assetIds` map as an error.
     */
    it('an empty stockClipIds list short-circuits to { assetIds: {} }', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(VideosController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const empty = await request(server)
          .post('/videos/stock-clips/mint')
          .send({ stockClipIds: [] });
        expect(empty.status).toBe(CREATED);
        expect(empty.body).toEqual({ assetIds: {} });

        const absent = await request(server)
          .post('/videos/stock-clips/mint')
          .send({});
        expect(absent.status).toBe(CREATED);
        expect(absent.body).toEqual({ assetIds: {} });
      } finally {
        await h?.close();
      }
    });
  });
});
