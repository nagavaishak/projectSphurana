import { randomUUID } from 'node:crypto';
/**
 * CHARACTERIZATION suite for `apps/api/src/assets/assets.controller.ts`.
 *
 * Purpose: freeze the controller's OBSERVABLE behaviour before its
 * orchestration is lifted into use cases. Every assertion here must keep
 * holding after the move; if one breaks, the refactor changed behaviour.
 *
 * What is exercised: the real Nest HTTP pipeline, the real feature services and
 * real SQL against a testcontainers Postgres (harness.ts). Only AuthGuard is
 * faked (identity stamping). NOTHING is mocked.
 *
 * Two controller-level facts worth stating up front, because they are easy to
 * change by accident during a refactor:
 *
 *  1. ROLE BOUNDARY — there is NONE. `AssetsController` declares
 *     `@UseGuards(AuthGuard)` ONLY: RoleGuard is not applied at all and no
 *     method carries @RequireRole. Any authenticated member of the active org
 *     can read, write, tag, link and DELETE every asset. This suite pins that
 *     as-is behaviour (a plain `member` succeeds everywhere) rather than
 *     asserting a gate that does not exist.
 *  2. URL RESOLUTION — `getAssetUrl` (via `extractS3Key`) is the prime
 *     extraction candidate. It is pinned below on its two deterministic
 *     branches (unparseable input passes through verbatim; parseable input
 *     keeps its object key) — see the "URL resolution" describe.
 *
 * ENVIRONMENT BOUNDARY: CloudFront signing and S3 presigning need real
 * credentials/keys that the integration env deliberately does not carry
 * (`apps/api/.env.integration` sets only the two bucket names). So the exact
 * signed-URL string cannot be pinned here. What IS pinned is the part of
 * `getAssetUrl` that is credential-independent and that a refactor could
 * plausibly break: the fallback branch and key preservation.
 */
import {
  type AssetSource,
  type AssetType,
  asset,
  assetAnalysis,
  assetService,
  assetUploadBatch,
  db,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { AssetsController } from '../assets/assets.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';

const OK = 200;
const CREATED = 201;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const CONFLICT = 409;

/** Insert an `asset` row directly (bypasses createAsset's zod URL check). */
async function seedAsset(input: {
  organizationId: string;
  uploadedById: string;
  blobUrl?: string;
  thumbnailUrl?: string | null;
  name?: string;
  type?: AssetType;
  source?: AssetSource;
  tags?: string[];
  batchId?: string;
}): Promise<string> {
  const id = `ast_${randomUUID()}`;
  await db.insert(asset).values({
    id,
    name: input.name ?? 'Test Asset',
    blobUrl:
      input.blobUrl ??
      `https://test-org-assets.s3.eu-west-1.amazonaws.com/${input.organizationId}/videos/${id}.mp4`,
    thumbnailUrl: input.thumbnailUrl ?? null,
    type: input.type ?? 'video',
    source: input.source ?? 'raw',
    tags: input.tags ?? [],
    organizationId: input.organizationId,
    uploadedById: input.uploadedById,
    batchId: input.batchId,
  });
  return id;
}

async function junctionServiceIds(assetId: string): Promise<string[]> {
  const rows = await db
    .select({ serviceId: assetService.serviceId })
    .from(assetService)
    .where(eq(assetService.assetId, assetId));
  return rows.map((r) => r.serviceId).sort();
}

async function withApp(
  identity: { userId: string; organizationId: string | undefined },
  fn: (
    server: ReturnType<IntegrationApp['app']['getHttpServer']>
  ) => Promise<void>
): Promise<void> {
  let h: IntegrationApp | undefined;
  try {
    h = await buildControllerApp(AssetsController, identity);
    await fn(h.app.getHttpServer());
  } finally {
    await h?.close();
  }
}

describe('AssetsController — characterization (HTTP + real Postgres)', () => {
  /* ---------------------------------------------------------------- */
  /* 1. URL resolution — the `getAssetUrl` / `extractS3Key` helper.    */
  /* ---------------------------------------------------------------- */
  describe('URL resolution (getAssetUrl)', () => {
    it('returns a blobUrl that cannot be parsed as a URL completely unchanged', async () => {
      // PROTECTS: `extractS3Key` returns null for a non-URL string, and
      // `getAssetUrl` then short-circuits and hands back the STORED value
      // byte-for-byte. No signing, no rewriting, no throw. A refactor that
      // starts prefixing/normalising unparseable values breaks this.
      const owner = await seedOrgWithMember('owner');
      const stored = 'not-a-url-at-all';
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        blobUrl: stored,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/assets/${assetId}`);
          expect(res.status).toBe(OK);
          expect(res.body.blobUrl).toBe(stored);
        }
      );
    });

    it('preserves the S3 object key (URL path) when resolving a stored S3 URL', async () => {
      // PROTECTS: the key `getAssetUrl` resolves is the URL PATH of the stored
      // blobUrl, minus the leading slash — regardless of which host/bucket the
      // stored URL names. Whatever URL comes back (signed CDN, presigned S3, or
      // the original on a signing failure), it addresses THAT SAME KEY. This is
      // the invariant that decides whether a user's media 404s after a
      // refactor, and it holds in every branch of the helper.
      const owner = await seedOrgWithMember('owner');
      const key = `${owner.organizationId}/images/${owner.userId}/1700000000000.jpg`;
      const stored = `https://some-other-bucket.s3.eu-west-1.amazonaws.com/${key}`;
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        blobUrl: stored,
        type: 'image',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/assets/${assetId}`);
          expect(res.status).toBe(OK);
          const resolved = new URL(res.body.blobUrl as string);
          expect(resolved.protocol).toBe('https:');
          expect(resolved.pathname).toBe(`/${key}`);
        }
      );
    });

    it('resolves blobUrl AND thumbnailUrl on the list route, and leaves a null thumbnail null', async () => {
      // PROTECTS: the list handler resolves BOTH url fields per item, and does
      // NOT invent a thumbnail for an asset that has none (`item.thumbnailUrl`
      // is passed through untouched when falsy). The per-item fan-out
      // (Promise.all) is the part being extracted.
      const owner = await seedOrgWithMember('owner');
      const thumbKey = `${owner.organizationId}/thumbs/a.jpg`;
      const withThumb = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        name: 'has-thumb',
        thumbnailUrl: `https://test-org-assets.s3.eu-west-1.amazonaws.com/${thumbKey}`,
      });
      const noThumb = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        name: 'no-thumb',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get('/assets');
          expect(res.status).toBe(OK);
          const items = res.body.items as Array<{
            id: string;
            blobUrl: string;
            thumbnailUrl: string | null;
          }>;

          const a = items.find((i) => i.id === withThumb);
          expect(a).toBeDefined();
          expect(new URL(a?.thumbnailUrl as string).pathname).toBe(
            `/${thumbKey}`
          );

          const b = items.find((i) => i.id === noThumb);
          expect(b).toBeDefined();
          expect(b?.thumbnailUrl).toBeNull();
        }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* 2. Fat handlers — outcome read back FROM POSTGRES.               */
  /* ---------------------------------------------------------------- */
  describe('POST /assets (create)', () => {
    it('persists the asset owned by the active org and the CALLING user, with normalised tags', async () => {
      // PROTECTS: the controller injects organizationId (from the active org)
      // and uploadedById (from @CurrentUser) — the client cannot supply them —
      // and defaults `tags` to [] / `type` to 'video'. Tag normalisation
      // (trim + lowercase + dedupe) and the video-only `transcodeStatus:
      // 'pending'` are read back from Postgres, not from the response body.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/assets')
            .send({
              name: 'Clip One',
              blobUrl:
                'https://test-org-assets.s3.eu-west-1.amazonaws.com/o/videos/clip.mp4',
              tags: ['  Before ', 'BEFORE', 'after'],
            });
          expect(res.status).toBe(CREATED);
          const id: string = res.body.id;
          expect(id).toBeTruthy();

          const row = await db.query.asset.findFirst({
            where: eq(asset.id, id),
          });
          expect(row?.name).toBe('Clip One');
          expect(row?.organizationId).toBe(owner.organizationId);
          expect(row?.uploadedById).toBe(owner.userId);
          expect(row?.tags).toEqual(['before', 'after']);
          expect(row?.type).toBe('video');
          expect(row?.source).toBe('raw');
          expect(row?.transcodeStatus).toBe('pending');
        }
      );
    });

    it('an image asset is stored with transcodeStatus "skipped"', async () => {
      // PROTECTS: the video-only transcode branch. Images must NOT enter the
      // probe/transcode pipeline.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post('/assets').send({
            name: 'Photo',
            blobUrl:
              'https://test-org-assets.s3.eu-west-1.amazonaws.com/o/images/p.jpg',
            type: 'image',
          });
          expect(res.status).toBe(CREATED);
          const row = await db.query.asset.findFirst({
            where: eq(asset.id, res.body.id),
          });
          expect(row?.type).toBe('image');
          expect(row?.transcodeStatus).toBe('skipped');
        }
      );
    });

    it('rejects a body with no blobUrl → 400, and writes nothing', async () => {
      // PROTECTS: validation failure maps to 400 (VALIDATION_ERROR →
      // BAD_REQUEST in mapErrorToHttpException) and is a no-op on the table.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/assets')
            .send({ name: 'No URL' });
          expect(res.status).toBe(BAD_REQUEST);

          const rows = await db
            .select({ id: asset.id })
            .from(asset)
            .where(eq(asset.organizationId, owner.organizationId));
          expect(rows).toHaveLength(0);
        }
      );
    });
  });

  describe('POST /assets/batch + GET /assets/batch/:batchId', () => {
    it('creates a batch owned by the caller and lists only that batch’s assets', async () => {
      // PROTECTS: createdById comes from @CurrentUser, totalAssets from the
      // body, and the batch listing is filtered by batchId (an asset in the
      // same org but a different batch must not appear).
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const created = await request(server)
            .post('/assets/batch')
            .send({ totalAssets: 3 });
          expect(created.status).toBe(CREATED);
          const batchId: string = created.body.id;

          const batchRow = await db.query.assetUploadBatch.findFirst({
            where: eq(assetUploadBatch.id, batchId),
          });
          expect(batchRow?.totalAssets).toBe(3);
          expect(batchRow?.completedAssets).toBe(0);
          expect(batchRow?.status).toBe('processing');
          expect(batchRow?.organizationId).toBe(owner.organizationId);
          expect(batchRow?.createdById).toBe(owner.userId);

          const inBatch = await seedAsset({
            organizationId: owner.organizationId,
            uploadedById: owner.userId,
            name: 'in-batch',
            batchId,
          });
          await seedAsset({
            organizationId: owner.organizationId,
            uploadedById: owner.userId,
            name: 'out-of-batch',
          });

          const listed = await request(server).get(`/assets/batch/${batchId}`);
          expect(listed.status).toBe(OK);
          const ids = (listed.body.items as Array<{ id: string }>).map(
            (i) => i.id
          );
          expect(ids).toEqual([inBatch]);
          expect(listed.body.total).toBe(1);
          expect(listed.body.limit).toBe(50);
          expect(listed.body.offset).toBe(0);
        }
      );
    });
  });

  describe('PUT /assets/:id/content-type', () => {
    it('persists the content type on the analysis row AND rewrites the asset’s content-type tag', async () => {
      // PROTECTS: the two-table side effect — the enum lands on
      // `asset_analysis.content_type`, and `asset.tags` is rewritten so exactly
      // one content-type tag ('testimonial') is present, ahead of the
      // non-content-type tags that survive untouched.
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        tags: ['before', 'summer'],
      });
      await db.insert(assetAnalysis).values({ assetId, status: 'completed' });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/assets/${assetId}/content-type`)
            .send({ contentType: 'testimonial' });
          expect(res.status).toBe(OK);

          // Read back from Postgres, not the response body.
          const analysis = await db.query.assetAnalysis.findFirst({
            where: eq(assetAnalysis.assetId, assetId),
          });
          expect(analysis?.contentType).toBe('testimonial');

          const row = await db.query.asset.findFirst({
            where: eq(asset.id, assetId),
          });
          expect(row?.tags).toEqual(['testimonial', 'summer']);
        }
      );
    });

    it('404s when the asset has never been analysed (no analysis row to update)', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/assets/${assetId}/content-type`)
            .send({ contentType: 'testimonial' });
          expect(res.status).toBe(NOT_FOUND);
        }
      );
    });

    it('rejects an unknown content type → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/assets/${assetId}/content-type`)
            .send({ contentType: 'not-a-real-type' });
          expect(res.status).toBe(BAD_REQUEST);
        }
      );
    });
  });

  describe('tag routes (PUT / POST / DELETE :id/tags)', () => {
    it('PUT replaces, POST merges, DELETE removes — each normalised and read back from Postgres', async () => {
      // PROTECTS: the three tag verbs are DIFFERENT operations on the same
      // column. Collapsing them during a refactor (e.g. making POST replace)
      // silently destroys user data.
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        tags: ['before'],
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          // PUT = replace wholesale.
          const replaced = await request(server)
            .put(`/assets/${assetId}/tags`)
            .send({ tags: ['After', ' RESULT '] });
          expect(replaced.status).toBe(OK);
          expect(
            (await db.query.asset.findFirst({ where: eq(asset.id, assetId) }))
              ?.tags
          ).toEqual(['after', 'result']);

          // POST = merge with existing (and dedupe against them).
          const added = await request(server)
            .post(`/assets/${assetId}/tags`)
            .send({ tags: ['procedure', 'AFTER'] });
          expect(added.status).toBe(CREATED);
          expect(
            (await db.query.asset.findFirst({ where: eq(asset.id, assetId) }))
              ?.tags
          ).toEqual(['after', 'result', 'procedure']);

          // DELETE = remove the named tags only.
          const removed = await request(server)
            .delete(`/assets/${assetId}/tags`)
            .send({ tags: ['result'] });
          expect(removed.status).toBe(OK);
          expect(
            (await db.query.asset.findFirst({ where: eq(asset.id, assetId) }))
              ?.tags
          ).toEqual(['after', 'procedure']);
        }
      );
    });

    it('a tag write against an asset in another org → 404 and leaves that row untouched', async () => {
      // PROTECTS: org isolation on a WRITE path (the service scopes its lookup
      // by organizationId and returns NOT_FOUND → 404).
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bAsset = await seedAsset({
        organizationId: orgB.organizationId,
        uploadedById: orgB.userId,
        tags: ['bees'],
      });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/assets/${bAsset}/tags`)
            .send({ tags: ['hijacked'] });
          expect(res.status).toBe(NOT_FOUND);

          const row = await db.query.asset.findFirst({
            where: eq(asset.id, bAsset),
          });
          expect(row?.tags).toEqual(['bees']);
        }
      );
    });
  });

  describe('service-link routes (POST / DELETE :id/services)', () => {
    it('links the services as MANUAL, then unlinks exactly the named ones', async () => {
      // PROTECTS: the controller hardcodes `isManual: true` on link (the
      // service records it as not auto-generated) and unlink removes only the
      // requested ids, leaving other links in place.
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      const svcA = await seedService({
        organizationId: owner.organizationId,
        name: `svc-a-${randomUUID()}`,
      });
      const svcB = await seedService({
        organizationId: owner.organizationId,
        name: `svc-b-${randomUUID()}`,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const linked = await request(server)
            .post(`/assets/${assetId}/services`)
            .send({ serviceIds: [svcA, svcB] });
          expect(linked.status).toBe(CREATED);
          expect(await junctionServiceIds(assetId)).toEqual(
            [svcA, svcB].sort()
          );

          const rows = await db
            .select({ isAutoGenerated: assetService.isAutoGenerated })
            .from(assetService)
            .where(eq(assetService.assetId, assetId));
          expect(rows.every((r) => r.isAutoGenerated === false)).toBe(true);

          const unlinked = await request(server)
            .delete(`/assets/${assetId}/services`)
            .send({ serviceIds: [svcA] });
          expect(unlinked.status).toBe(OK);
          expect(unlinked.body.deletedCount).toBe(1);
          expect(await junctionServiceIds(assetId)).toEqual([svcB]);
        }
      );
    });

    it('linking a service id that does not exist → 404 and links nothing', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      const svcA = await seedService({
        organizationId: owner.organizationId,
        name: `svc-missing-${randomUUID()}`,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post(`/assets/${assetId}/services`)
            .send({ serviceIds: [svcA, 'svc_does_not_exist'] });
          expect(res.status).toBe(NOT_FOUND);
          expect(await junctionServiceIds(assetId)).toEqual([]);
        }
      );
    });
  });

  describe('analysis routes', () => {
    it('POST :id/analyze writes a queued assetAnalysis row; a second call while queued re-queues it', async () => {
      // PROTECTS: the analyze handler's local DB effect (the row + its status)
      // — the part that survives without the AI worker. Enqueue to BullMQ is a
      // side effect we do not assert here; the row is the observable outcome.
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/assets/${assetId}/analyze`);
          expect(res.status).toBe(CREATED);

          const row = await db.query.assetAnalysis.findFirst({
            where: eq(assetAnalysis.assetId, assetId),
          });
          expect(row?.status).toBe('queued');
          expect(row?.assetId).toBe(assetId);

          // Re-analysing an already-queued asset is allowed (only
          // status='processing' is rejected) and does NOT create a second row.
          const again = await request(server).post(
            `/assets/${assetId}/analyze`
          );
          expect(again.status).toBe(CREATED);
          const all = await db
            .select({ id: assetAnalysis.id })
            .from(assetAnalysis)
            .where(eq(assetAnalysis.assetId, assetId));
          expect(all).toHaveLength(1);
        }
      );
    });

    it('POST :id/analyze on an EDITED asset → 400 (analysis is raw-footage only)', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        source: 'edited',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/assets/${assetId}/analyze`);
          expect(res.status).toBe(BAD_REQUEST);
          const rows = await db
            .select({ id: assetAnalysis.id })
            .from(assetAnalysis)
            .where(eq(assetAnalysis.assetId, assetId));
          expect(rows).toHaveLength(0);
        }
      );
    });

    it('POST :id/analyze while status=processing → 409', async () => {
      // PROTECTS: CONFLICT → 409 in mapErrorToHttpException.
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      await db.insert(assetAnalysis).values({ assetId, status: 'processing' });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/assets/${assetId}/analyze`);
          expect(res.status).toBe(CONFLICT);
        }
      );
    });

    it('GET :id/analysis returns analysis:null + the linked services for an unanalysed asset', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      const serviceName = `Facial ${randomUUID()}`;
      const svcA = await seedService({
        organizationId: owner.organizationId,
        name: serviceName,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          await request(server)
            .post(`/assets/${assetId}/services`)
            .send({ serviceIds: [svcA] });

          const res = await request(server).get(`/assets/${assetId}/analysis`);
          expect(res.status).toBe(OK);
          expect(res.body.analysis).toBeNull();
          expect(res.body.linkedServices).toHaveLength(1);
          expect(res.body.linkedServices[0].serviceId).toBe(svcA);
          expect(res.body.linkedServices[0].serviceName).toBe(serviceName);
        }
      );
    });
  });

  describe('DELETE /assets/:id', () => {
    it('removes the asset from subsequent reads', async () => {
      const owner = await seedOrgWithMember('owner');
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).delete(`/assets/${assetId}`);
          expect(res.status).toBe(OK);
          expect(res.body.id).toBe(assetId);

          // Gone for reads (hard-deleted, or soft-deleted behind notDeleted()).
          const got = await request(server).get(`/assets/${assetId}`);
          expect(got.status).toBe(NOT_FOUND);

          const list = await request(server).get('/assets');
          expect(
            (list.body.items as Array<{ id: string }>).some(
              (i) => i.id === assetId
            )
          ).toBe(false);
        }
      );
    });

    it('deleting an id that does not exist returns 200 with an EMPTY body (not 404)', async () => {
      // PROTECTS (and documents) today's behaviour: `deleteAsset` resolves to
      // ok(null) when nothing matched, and the controller returns
      // `result.data` verbatim — so the client sees 200 + empty body. See the
      // FINDINGS note at the bottom of this file: arguably it should be 404.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).delete('/assets/ast_nope');
          expect(res.status).toBe(OK);
          expect(res.body).toEqual({});
        }
      );
    });

    it('deleting ANOTHER org’s asset returns 200 + empty body and the row SURVIVES', async () => {
      // PROTECTS: the delete is org-scoped in SQL, so cross-org data is safe —
      // which is the important half. The 200 (rather than 404) is the same
      // ok(null) path as above.
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bAsset = await seedAsset({
        organizationId: orgB.organizationId,
        uploadedById: orgB.userId,
      });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server).delete(`/assets/${bAsset}`);
          expect(res.status).toBe(OK);
          expect(res.body).toEqual({});

          const row = await db.query.asset.findFirst({
            where: and(
              eq(asset.id, bAsset),
              eq(asset.organizationId, orgB.organizationId)
            ),
          });
          expect(row?.id).toBe(bAsset);
          expect(row?.deletedAt).toBeNull();
        }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* 3. Listing filters + org isolation + the no-active-org gate.      */
  /* ---------------------------------------------------------------- */
  describe('GET /assets (list)', () => {
    it('scopes to the active org, honours ?type, and hides source=stock assets', async () => {
      // PROTECTS: three filter rules that all live behind one handler — org
      // scoping, the `type` query param passthrough, and the hard-coded
      // exclusion of stock library assets from the org gallery.
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      const aVideo = await seedAsset({
        organizationId: orgA.organizationId,
        uploadedById: orgA.userId,
        name: 'a-video',
      });
      const aImage = await seedAsset({
        organizationId: orgA.organizationId,
        uploadedById: orgA.userId,
        name: 'a-image',
        type: 'image',
      });
      const aStock = await seedAsset({
        organizationId: orgA.organizationId,
        uploadedById: orgA.userId,
        name: 'a-stock',
        source: 'stock',
      });
      const bVideo = await seedAsset({
        organizationId: orgB.organizationId,
        uploadedById: orgB.userId,
        name: 'b-video',
      });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const all = await request(server).get('/assets');
          expect(all.status).toBe(OK);
          const ids = (all.body.items as Array<{ id: string }>).map(
            (i) => i.id
          );
          expect(ids.sort()).toEqual([aImage, aVideo].sort());
          expect(ids).not.toContain(aStock);
          expect(ids).not.toContain(bVideo);
          expect(all.body.total).toBe(2);

          const videosOnly = await request(server).get('/assets?type=video');
          expect(
            (videosOnly.body.items as Array<{ id: string }>).map((i) => i.id)
          ).toEqual([aVideo]);
        }
      );
    });

    it('parses ?tags as a comma-separated list (whitespace trimmed)', async () => {
      // PROTECTS: the tag-string parsing that lives IN the controller (split
      // on ',', trim, drop empties) — a pure transformation that must move
      // intact.
      const owner = await seedOrgWithMember('owner');
      const tagged = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        name: 'tagged',
        tags: ['before'],
      });
      await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        name: 'untagged',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(
            '/assets?tags=%20before%20,,%20nothing'
          );
          expect(res.status).toBe(OK);
          expect(
            (res.body.items as Array<{ id: string }>).map((i) => i.id)
          ).toEqual([tagged]);
        }
      );
    });

    it('defaults limit/offset to 50/0, honours explicit values, and returns total = MATCHING ROW COUNT', async () => {
      // PROTECTS: the pagination envelope the controller forwards verbatim.
      //
      // The `total` half of this pin is INVERTED. `listAssets` used to return
      // `total: itemsWithServices.length` — the size of THIS PAGE — so with
      // limit=1 over 2 assets total was 1, and a paginating client could never
      // learn the row count or render page controls. The FINDINGS block called
      // it out as looking like a bug; it was one.
      //
      // `?limit=1&offset=1` returning `total: 2` is the whole point: total must
      // be independent of the page window.
      const owner = await seedOrgWithMember('owner');
      await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });
      await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const dflt = await request(server).get('/assets');
          expect(dflt.body.limit).toBe(50);
          expect(dflt.body.offset).toBe(0);
          expect(dflt.body.total).toBe(2);

          const paged = await request(server).get('/assets?limit=1&offset=1');
          expect(paged.body.limit).toBe(1);
          expect(paged.body.offset).toBe(1);
          expect(paged.body.items).toHaveLength(1);
          // The page holds 1 row; 2 match. total describes the MATCH SET.
          expect(paged.body.total).toBe(2);
        }
      );
    });
  });

  describe('GET /assets/by-service/:serviceId', () => {
    it('returns only assets linked to that service, with resolved urls', async () => {
      const owner = await seedOrgWithMember('owner');
      const svcA = await seedService({
        organizationId: owner.organizationId,
        name: `by-svc-a-${randomUUID()}`,
      });
      const svcB = await seedService({
        organizationId: owner.organizationId,
        name: `by-svc-b-${randomUUID()}`,
      });
      const linkedAsset = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        name: 'linked',
      });
      await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        name: 'unlinked',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          await request(server)
            .post(`/assets/${linkedAsset}/services`)
            .send({ serviceIds: [svcA] });

          const res = await request(server).get(`/assets/by-service/${svcA}`);
          expect(res.status).toBe(OK);
          const items = res.body.items as Array<{
            id: string;
            blobUrl: string;
          }>;
          expect(items.map((i) => i.id)).toEqual([linkedAsset]);
          expect(items[0].blobUrl.startsWith('https://')).toBe(true);

          const other = await request(server).get(`/assets/by-service/${svcB}`);
          expect(other.status).toBe(OK);
          expect(other.body.items).toEqual([]);
        }
      );
    });
  });

  describe('org isolation + active-organization gate', () => {
    it('GET /assets/:id for another org’s asset → 404', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bAsset = await seedAsset({
        organizationId: orgB.organizationId,
        uploadedById: orgB.userId,
      });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server).get(`/assets/${bAsset}`);
          expect(res.status).toBe(NOT_FOUND);
        }
      );
    });

    it('every route 400s with "No active organization selected" when no org is active', async () => {
      // PROTECTS: `requireActiveOrganization` — the first thing each handler
      // does. It must keep producing 400 (not 401/500) with this exact message.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: undefined },
        async (server) => {
          const list = await request(server).get('/assets');
          expect(list.status).toBe(BAD_REQUEST);
          expect(list.body.message).toBe('No active organization selected');

          const create = await request(server)
            .post('/assets')
            .send({ name: 'x', blobUrl: 'https://example.com/a.mp4' });
          expect(create.status).toBe(BAD_REQUEST);

          const one = await request(server).get('/assets/whatever');
          expect(one.status).toBe(BAD_REQUEST);
        }
      );
    });

    it('a plain MEMBER can read and upload assets, but CANNOT delete one', async () => {
      // This pin is INVERTED from what it was. It used to assert a member could
      // both upload AND delete, protecting "the deliberate absence of RoleGuard
      // on AssetsController", and closed: "If a refactor adds a role check, this
      // test fails and forces that decision to be explicit rather than
      // accidental." This is that decision, made explicitly.
      //
      // The gate is narrow on purpose. Reads and uploads stay open — members
      // need the media library, and an unwanted upload is reversible. DELETE is
      // the one irreversible action, and it destroys work other people's videos
      // and ads reference, so it now requires admin.
      const org = await seedOrgWithMember('owner');
      const memberOfSameOrg = await seedOrgWithMember('member', {
        organizationId: org.organizationId,
      });

      await withApp(
        {
          userId: memberOfSameOrg.userId,
          organizationId: org.organizationId,
        },
        async (server) => {
          const created = await request(server).post('/assets').send({
            name: 'member upload',
            blobUrl:
              'https://test-org-assets.s3.eu-west-1.amazonaws.com/o/v.mp4',
          });
          expect(created.status).toBe(CREATED);

          const deleted = await request(server).delete(
            `/assets/${created.body.id}`
          );
          expect(deleted.status).toBe(FORBIDDEN);
        }
      );

      // ...and the asset is still there. A 403 that had already deleted the row
      // would be the same defect wearing a different status code.
      await withApp(
        { userId: org.userId, organizationId: org.organizationId },
        async (server) => {
          const list = await request(server).get('/assets');
          expect(list.status).toBe(OK);
          expect(
            (list.body.items as { name: string }[]).some(
              (a) => a.name === 'member upload'
            )
          ).toBe(true);
        }
      );
    });
  });
});

/*
 * FINDINGS (reported, deliberately NOT fixed here):
 *
 *  1. DELETE /assets/:id returns 200 with an empty body for an id that does not
 *     exist OR belongs to another org (`deleteAsset` → ok(null), controller
 *     returns result.data). Every other route in this controller 404s on a
 *     missing row. Pinned by the two DELETE tests above.
 *  2. AssetsController has NO RoleGuard and no @RequireRole anywhere: a plain
 *     `member` can delete any asset in the org. FIXED — DELETE /assets/:id now
 *     requires admin; reads, uploads and curation stay open. Pin inverted.
 *  3. GET /assets returns `total` = the length of the CURRENT PAGE. FIXED —
 *     `listAssets` now counts over the same `conditions`. Pin inverted.
 *  4. POST /assets/batch creates the batch already in status 'processing'
 *     (never 'pending', which is the column default). Pinned above.
 */
