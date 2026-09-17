import { randomUUID } from 'node:crypto';
/**
 * CHARACTERIZATION suite for `apps/api/src/meta-ads/meta-ads.controller.ts`.
 *
 * Purpose: freeze the controller's OBSERVABLE behaviour before its
 * orchestration is lifted into use cases. Real Nest HTTP pipeline, real
 * RoleGuard, real feature services, real SQL against a testcontainers Postgres
 * (harness.ts). Only AuthGuard is faked. NOTHING is mocked.
 *
 * THE LIVE-META BOUNDARY (read this before adding tests here)
 * ----------------------------------------------------------
 * Several routes must talk to Meta's Graph API. In this harness the org has NO
 * `meta_ads_integration` row, so `getMetaCredentials` fails FIRST and the
 * handler returns before any network call. That is a genuine, deterministic
 * observable contract (`META_NOT_CONFIGURED` → 412) and it is pinned below —
 * but it means the post-credential half of launch/publish/import/sync/
 * health-check is NOT covered here. Those need the flagship staging E2E. The
 * controller is never stubbed to fake its way past that boundary.
 *
 * Everything BEFORE the boundary is fully covered: DTO/zod validation, the
 * active-organization gate, RoleGuard's admin gate, org isolation, the local
 * Postgres writes, the media-URL resolution helpers, and error→status mapping.
 *
 * `resolveMediaUrl` / `resolveGraphicUrl` (the extraction candidates) are
 * pinned on the branches that do not require AWS credentials: a non-S3,
 * non-CDN URL (e.g. Meta's own fbcdn) passes through byte-for-byte, and an S3
 * URL keeps its object key. CloudFront signing is disabled in the integration
 * env (`apps/api/.env.integration` sets only the bucket names), so an exact
 * signed string cannot be asserted here.
 */
import {
  asset,
  db,
  graphic,
  metaAd,
  metaAdService,
  video,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { MetaAdsController } from '../meta-ads/meta-ads.controller.js';
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
const PRECONDITION_FAILED = 412;

const S3_HOST = 'https://test-org-assets.s3.eu-west-1.amazonaws.com';
/** A Meta CDN URL — neither an S3 URL nor our CDN base. */
const FBCDN_URL =
  'https://scontent.xx.fbcdn.net/v/t15.1234-10/567_n.jpg?_nc_cat=1&oh=abc';

async function seedVideo(input: {
  organizationId: string;
  createdById: string;
  blobUrl?: string | null;
  thumbnailUrl?: string | null;
  status?: 'draft' | 'ready';
}): Promise<string> {
  const id = `vid_${randomUUID()}`;
  await db.insert(video).values({
    id,
    title: 'Test Video',
    organizationId: input.organizationId,
    createdById: input.createdById,
    status: input.status ?? 'draft',
    blobUrl: input.blobUrl ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null,
  });
  return id;
}

async function seedGraphic(input: {
  organizationId: string;
  createdById: string;
  outputUrl?: string;
  objectKey?: string;
}): Promise<string> {
  const id = `gfx_${randomUUID()}`;
  await db.insert(graphic).values({
    id,
    organizationId: input.organizationId,
    createdById: input.createdById,
    status: 'ready',
    outputs: input.outputUrl
      ? [
          {
            aspectRatioId: '4:5',
            platform: 'instagram',
            width: 1080,
            height: 1350,
            url: input.outputUrl,
            format: 'png' as const,
            renderedAt: new Date().toISOString(),
            ...(input.objectKey ? { objectKey: input.objectKey } : {}),
          },
        ]
      : null,
  });
  return id;
}

/**
 * `metaAd.videoId` holds EITHER a `video.id` OR an `asset.id` — the schema says
 * so and the LAUNCH path (`resolveMediaAsset`) has always honoured both. The
 * READ path only joined `video`, so an asset-backed ad had no creative to
 * preview: 42 of 130 production ads across 20 organisations, 12 of which had no
 * Meta thumbnail to fall back on and so previewed completely blank.
 */
async function seedAsset(input: {
  organizationId: string;
  uploadedById: string;
  type?: 'video' | 'image';
  blobUrl: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  transcodedBlobUrl?: string | null;
  transcodeStatus?: 'pending' | 'skipped' | 'ready' | 'failed';
}): Promise<string> {
  const id = `ast_${randomUUID()}`;
  await db.insert(asset).values({
    id,
    name: 'Seeded Asset',
    organizationId: input.organizationId,
    uploadedById: input.uploadedById,
    type: input.type ?? 'video',
    blobUrl: input.blobUrl,
    thumbnailUrl: input.thumbnailUrl ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    duration: input.duration ?? null,
    transcodedBlobUrl: input.transcodedBlobUrl ?? null,
    transcodeStatus: input.transcodeStatus ?? 'skipped',
  });
  return id;
}

async function seedAd(input: {
  organizationId: string;
  name?: string;
  metaCampaignId?: string | null;
  videoId?: string | null;
  graphicId?: string | null;
  status?: 'draft' | 'pending' | 'launching';
  metaAdId?: string | null;
  headline?: string;
}): Promise<string> {
  const id = `ad_${randomUUID()}`;
  await db.insert(metaAd).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? 'Seeded Ad',
    metaCampaignId: input.metaCampaignId ?? `camp_${randomUUID()}`,
    videoId: input.videoId ?? null,
    graphicId: input.graphicId ?? null,
    status: input.status ?? 'draft',
    metaAdId: input.metaAdId ?? null,
    headline: input.headline,
  });
  return id;
}

async function adServiceIds(adId: string): Promise<string[]> {
  const rows = await db
    .select({ serviceId: metaAdService.serviceId })
    .from(metaAdService)
    .where(eq(metaAdService.metaAdId, adId));
  return rows.map((r) => r.serviceId).sort();
}

function uniqueService(organizationId: string): Promise<string> {
  return seedService({ organizationId, name: `svc-${randomUUID()}` });
}

async function withApp(
  identity: { userId: string; organizationId: string | undefined },
  fn: (
    server: ReturnType<IntegrationApp['app']['getHttpServer']>
  ) => Promise<void>
): Promise<void> {
  let h: IntegrationApp | undefined;
  try {
    h = await buildControllerApp(MetaAdsController, identity);
    await fn(h.app.getHttpServer());
  } finally {
    await h?.close();
  }
}

describe('MetaAdsController — characterization (HTTP + real Postgres)', () => {
  /* ---------------------------------------------------------------- */
  /* 1. Media-URL resolution helpers.                                  */
  /* ---------------------------------------------------------------- */
  describe('resolveMediaUrl / resolveGraphicUrl', () => {
    it('passes a Meta fbcdn URL through byte-for-byte, query string included', async () => {
      // PROTECTS: `resolveMediaUrl`'s terminal branch — a URL that is neither
      // under our CDN base nor parseable as S3 is returned EXACTLY as stored.
      // Meta creative URLs are already signed by Meta; re-signing or
      // normalising them (e.g. stripping the query) breaks every imported ad's
      // thumbnail.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        thumbnailUrl: FBCDN_URL,
        blobUrl: FBCDN_URL,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          expect(res.body.video.thumbnailUrl).toBe(FBCDN_URL);
          expect(res.body.video.blobUrl).toBe(FBCDN_URL);
        }
      );
    });

    it('keeps the S3 object key when resolving a stored S3 video URL', async () => {
      // PROTECTS: whichever way the URL is re-signed (CDN or presigned S3), it
      // must still address the SAME key. This is the invariant that decides
      // whether a user's video 404s after the helper moves.
      const owner = await seedOrgWithMember('owner');
      const key = `${owner.organizationId}/videos/${owner.userId}/final.mp4`;
      const thumbKey = `${owner.organizationId}/videos/${owner.userId}/thumb.jpg`;
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        blobUrl: `${S3_HOST}/${key}`,
        thumbnailUrl: `${S3_HOST}/${thumbKey}`,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          expect(new URL(res.body.video.blobUrl as string).pathname).toBe(
            `/${key}`
          );
          expect(new URL(res.body.video.thumbnailUrl as string).pathname).toBe(
            `/${thumbKey}`
          );
        }
      );
    });

    it('leaves a null video URL null and returns video:null when the ad has no creative video', async () => {
      // PROTECTS: the null-guards around resolveMediaUrl. A null thumbnail must
      // stay null rather than becoming a signed URL for the empty key.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        blobUrl: null,
        thumbnailUrl: null,
      });
      const withVideo = await seedAd({
        organizationId: owner.organizationId,
        videoId,
      });
      const withoutVideo = await seedAd({
        organizationId: owner.organizationId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const a = await request(server).get(`/meta-ads/${withVideo}`);
          expect(a.status).toBe(OK);
          expect(a.body.video.blobUrl).toBeNull();
          expect(a.body.video.thumbnailUrl).toBeNull();

          const b = await request(server).get(`/meta-ads/${withoutVideo}`);
          expect(b.status).toBe(OK);
          // getAd returns `video: undefined`, which JSON-drops the key.
          expect('video' in b.body).toBe(false);
          expect(b.body.graphicImageUrl).toBeNull();
        }
      );
    });

    it('exposes graphicImageUrl from the graphic’s first output and NEVER leaks graphicImageKey', async () => {
      // PROTECTS: two things at once — (a) the graphic creative's rendered URL
      // is surfaced to the client, and (b) the internal S3 object key that
      // `getAd` returns alongside it is DESTRUCTURED OFF the response. Leaking
      // the raw key is an information disclosure and the destructuring is easy
      // to drop when the handler is moved.
      const owner = await seedOrgWithMember('owner');
      const graphicId = await seedGraphic({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        outputUrl: FBCDN_URL,
        objectKey: `${owner.organizationId}/graphics/out.png`,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        graphicId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          // CDN signing is off in this env, so the URL falls through
          // resolveMediaUrl unchanged (fbcdn → passthrough).
          expect(res.body.graphicImageUrl).toBe(FBCDN_URL);
          expect('graphicImageKey' in res.body).toBe(false);
        }
      );
    });

    it('the list route resolves the same URLs and also strips graphicImageKey per item', async () => {
      // PROTECTS: the list handler duplicates the single-ad resolution inside a
      // Promise.all over the page. Both call sites must keep the same contract.
      const owner = await seedOrgWithMember('owner');
      const campaignId = `camp_${randomUUID()}`;
      const key = `${owner.organizationId}/videos/list.mp4`;
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        blobUrl: `${S3_HOST}/${key}`,
        thumbnailUrl: FBCDN_URL,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        videoId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(
            `/meta-ads/campaigns/${campaignId}`
          );
          expect(res.status).toBe(OK);
          const ads = res.body.ads as Array<{
            id: string;
            video: { videoUrl: string | null; thumbnailUrl: string | null };
          }>;
          expect(ads.map((a) => a.id)).toEqual([adId]);
          // NOTE: the LIST shape names the video field `videoUrl`; the SINGLE
          // shape names it `blobUrl`. That asymmetry is deliberate today.
          expect(new URL(ads[0].video.videoUrl as string).pathname).toBe(
            `/${key}`
          );
          expect(ads[0].video.thumbnailUrl).toBe(FBCDN_URL);
          expect('graphicImageKey' in ads[0]).toBe(false);
        }
      );
    });
    /* ------------------------------------------------------------ */
    /* Asset-backed creatives. REGRESSION GUARD — see `seedAsset`.   */
    /* ------------------------------------------------------------ */

    it('the single-ad route resolves a videoId that points at a VIDEO asset', async () => {
      // PROTECTS: the blank-preview bug. Before this, the `video` join missed
      // and the route answered with no creative at all, so the ad side panel
      // had nothing to show. Unit tests here would pass with a mocked db even
      // if the tables drifted — this runs against real SQL.
      const owner = await seedOrgWithMember('owner');
      const key = `${owner.organizationId}/assets/clip.mp4`;
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        type: 'video',
        blobUrl: `${S3_HOST}/${key}`,
        thumbnailUrl: FBCDN_URL,
        width: 1080,
        height: 1920,
        duration: 15,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId: assetId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          expect(res.body.video).toBeTruthy();
          expect(new URL(res.body.video.blobUrl as string).pathname).toBe(
            `/${key}`
          );
          expect(res.body.video.thumbnailUrl).toBe(FBCDN_URL);
          // The asset stores its own size, so the preview frame can take the
          // creative's shape on first paint instead of after the media loads.
          expect(res.body.video.width).toBe(1080);
          expect(res.body.video.height).toBe(1920);
        }
      );
    });

    it('an IMAGE asset is served as the image itself, not as a video', async () => {
      // PROTECTS: an image asset has no `thumbnailUrl` — its `blobUrl` IS the
      // creative. Serving it as `videoUrl` would render a broken player.
      const owner = await seedOrgWithMember('owner');
      const key = `${owner.organizationId}/assets/offer.png`;
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        type: 'image',
        blobUrl: `${S3_HOST}/${key}`,
        thumbnailUrl: null,
        width: 1080,
        height: 1350,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId: assetId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          expect(res.body.video.blobUrl).toBeNull();
          expect(new URL(res.body.video.thumbnailUrl as string).pathname).toBe(
            `/${key}`
          );
        }
      );
    });

    it('the list route resolves asset-backed creatives too', async () => {
      // PROTECTS: the list handler resolves the whole page in one batch. Both
      // call sites must keep the same contract — the list route is the one the
      // campaign page actually reads.
      const owner = await seedOrgWithMember('owner');
      const campaignId = `camp_${randomUUID()}`;
      const key = `${owner.organizationId}/assets/list-clip.mp4`;
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        type: 'video',
        blobUrl: `${S3_HOST}/${key}`,
        thumbnailUrl: FBCDN_URL,
        width: 720,
        height: 1280,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        videoId: assetId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(
            `/meta-ads/campaigns/${campaignId}`
          );
          expect(res.status).toBe(OK);
          const ads = res.body.ads as Array<{
            id: string;
            video: {
              videoUrl: string | null;
              thumbnailUrl: string | null;
              width: number | null;
              height: number | null;
            };
          }>;
          expect(ads.map((a) => a.id)).toEqual([adId]);
          expect(new URL(ads[0].video.videoUrl as string).pathname).toBe(
            `/${key}`
          );
          expect(ads[0].video.width).toBe(720);
          expect(ads[0].video.height).toBe(1280);
        }
      );
    });

    it('prefers the transcoded copy for playback when one is ready', async () => {
      // PROTECTS: originals can be codecs a browser will not play — the
      // transcode exists for exactly that. Serving the original would give the
      // customer a player that silently fails.
      const owner = await seedOrgWithMember('owner');
      const transcodedKey = `${owner.organizationId}/assets/clip.mp4`;
      const assetId = await seedAsset({
        organizationId: owner.organizationId,
        uploadedById: owner.userId,
        type: 'video',
        blobUrl: `${S3_HOST}/${owner.organizationId}/assets/clip-original.mov`,
        transcodedBlobUrl: `${S3_HOST}/${transcodedKey}`,
        transcodeStatus: 'ready',
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId: assetId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          expect(new URL(res.body.video.blobUrl as string).pathname).toBe(
            `/${transcodedKey}`
          );
        }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* 2. Role boundary — RoleGuard is REAL here.                        */
  /* ---------------------------------------------------------------- */
  describe('role boundary (@RequireRole("admin"))', () => {
    type Server = ReturnType<IntegrationApp['app']['getHttpServer']>;
    const adminGatedCalls: Array<{
      name: string;
      call: (server: Server, adId: string) => Promise<request.Response>;
    }> = [
      {
        name: 'POST /meta-ads',
        call: (s) => request(s).post('/meta-ads').send({}),
      },
      {
        name: 'POST /meta-ads/launch',
        call: (s) => request(s).post('/meta-ads/launch').send({}),
      },
      {
        name: 'POST /meta-ads/launch-from-post',
        call: (s) => request(s).post('/meta-ads/launch-from-post').send({}),
      },
      {
        name: 'PUT /meta-ads/:id',
        call: (s, id) => request(s).put(`/meta-ads/${id}`).send({ name: 'x' }),
      },
      {
        name: 'PUT /meta-ads/:id/creative',
        call: (s, id) =>
          request(s).put(`/meta-ads/${id}/creative`).send({ videoId: 'v' }),
      },
      {
        name: 'POST /meta-ads/:id/publish',
        call: (s, id) => request(s).post(`/meta-ads/${id}/publish`),
      },
      {
        name: 'POST /meta-ads/:id/promote-draft',
        call: (s, id) => request(s).post(`/meta-ads/${id}/promote-draft`),
      },
      {
        name: 'POST /meta-ads/:id/duplicate',
        call: (s, id) => request(s).post(`/meta-ads/${id}/duplicate`),
      },
      {
        name: 'DELETE /meta-ads/:id',
        call: (s, id) => request(s).delete(`/meta-ads/${id}`),
      },
    ];

    it('a plain MEMBER is refused 403 on every admin-gated route, and nothing is written', async () => {
      // PROTECTS: the @RequireRole('admin') set. RoleGuard runs BEFORE the
      // handler body and before DTO validation, so even a malformed body 403s
      // rather than 400 — that ordering is part of the contract.
      const org = await seedOrgWithMember('owner');
      const memberIdentity = await seedOrgWithMember('member', {
        organizationId: org.organizationId,
      });
      const adId = await seedAd({
        organizationId: org.organizationId,
        name: 'Untouchable',
      });

      await withApp(
        { userId: memberIdentity.userId, organizationId: org.organizationId },
        async (server) => {
          for (const { name, call } of adminGatedCalls) {
            const res = await call(server, adId);
            expect({ name, status: res.status }).toEqual({
              name,
              status: FORBIDDEN,
            });
          }
        }
      );

      // The seeded ad survived every refused call.
      const row = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(row?.name).toBe('Untouchable');
    });

    it('an ADMIN clears the guard — the same routes get past 403 to real handler outcomes', async () => {
      // PROTECTS: the gate is a ROLE gate, not a blanket deny. An admin reaches
      // the handler; what comes back is the handler's own status (400/404/412),
      // never 403.
      const org = await seedOrgWithMember('admin');
      const adId = await seedAd({ organizationId: org.organizationId });

      await withApp(
        { userId: org.userId, organizationId: org.organizationId },
        async (server) => {
          for (const { name, call } of adminGatedCalls) {
            const res = await call(server, adId);
            expect({ name, forbidden: res.status === FORBIDDEN }).toEqual({
              name,
              forbidden: false,
            });
          }
        }
      );
    });

    it('routes with NO @RequireRole are open to any member (health-check, import, sync, read)', async () => {
      // PROTECTS: the deliberate asymmetry — reads plus the three sync-ish
      // POSTs carry no role metadata, so RoleGuard passes through. Adding a
      // gate here during the refactor would silently break member users.
      const org = await seedOrgWithMember('owner');
      const memberIdentity = await seedOrgWithMember('member', {
        organizationId: org.organizationId,
      });
      const adId = await seedAd({ organizationId: org.organizationId });

      await withApp(
        { userId: memberIdentity.userId, organizationId: org.organizationId },
        async (server) => {
          expect((await request(server).get(`/meta-ads/${adId}`)).status).toBe(
            OK
          );
          expect(
            (await request(server).get('/meta-ads/health-check')).status
          ).not.toBe(FORBIDDEN);
          expect(
            (await request(server).post('/meta-ads/import')).status
          ).not.toBe(FORBIDDEN);
          expect(
            (await request(server).post(`/meta-ads/${adId}/sync`)).status
          ).not.toBe(FORBIDDEN);
        }
      );
    });

    it('a user who is not a member of the active org gets 403 on an admin route', async () => {
      // PROTECTS: RoleGuard's membership lookup (real SQL against `member`).
      const orgA = await seedOrgWithMember('owner');
      const outsider = await seedOrgWithMember('owner'); // owner of a DIFFERENT org
      const adId = await seedAd({ organizationId: orgA.organizationId });

      await withApp(
        { userId: outsider.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server).delete(`/meta-ads/${adId}`);
          expect(res.status).toBe(FORBIDDEN);
        }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* 3. Fat handlers — outcome read back FROM POSTGRES.                */
  /* ---------------------------------------------------------------- */
  describe('POST /meta-ads (create)', () => {
    it('persists a DRAFT ad scoped to the active org, with the default CTA and the service junction', async () => {
      // PROTECTS: the controller injects organizationId (client cannot set it)
      // and defaults callToAction to 'LEARN_MORE' — that default lives IN THE
      // CONTROLLER (`createAdDto.callToAction ?? 'LEARN_MORE'`), so it must
      // travel with the handler. Status/junction are read back from Postgres.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const svcA = await uniqueService(owner.organizationId);
      const campaignId = `camp_${randomUUID()}`;

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads')
            .send({
              metaCampaignId: campaignId,
              videoId,
              name: 'Summer Promo',
              serviceIds: [svcA],
            });
          expect(res.status).toBe(CREATED);
          const id: string = res.body.id;

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, id),
          });
          expect(row?.organizationId).toBe(owner.organizationId);
          expect(row?.name).toBe('Summer Promo');
          expect(row?.status).toBe('draft');
          expect(row?.callToAction).toBe('LEARN_MORE');
          expect(row?.videoId).toBe(videoId);
          expect(row?.graphicId).toBeNull();
          expect(row?.metaCampaignId).toBe(campaignId);
          expect(await adServiceIds(id)).toEqual([svcA]);
        }
      );
    });

    it('routes a GRAPHIC id passed in the videoId field into the graphicId column', async () => {
      // PROTECTS: the media-agnostic creative auto-detection. The ad wizard
      // posts a graphic id in `videoId`; the row must still land in
      // `graphic_id` (finalize-ad branches on it).
      const owner = await seedOrgWithMember('owner');
      const graphicId = await seedGraphic({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        outputUrl: FBCDN_URL,
      });
      const svcA = await uniqueService(owner.organizationId);

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads')
            .send({
              metaCampaignId: `camp_${randomUUID()}`,
              videoId: graphicId,
              name: 'Graphic Ad',
              serviceIds: [svcA],
            });
          expect(res.status).toBe(CREATED);

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, res.body.id),
          });
          expect(row?.graphicId).toBe(graphicId);
          expect(row?.videoId).toBeNull();
        }
      );
    });

    it('rejects an unknown creative id → 404 "Media not found", writing no row', async () => {
      const owner = await seedOrgWithMember('owner');
      const svcA = await uniqueService(owner.organizationId);

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads')
            .send({
              metaCampaignId: `camp_${randomUUID()}`,
              videoId: 'vid_does_not_exist',
              name: 'Doomed',
              serviceIds: [svcA],
            });
          expect(res.status).toBe(NOT_FOUND);
          expect(res.body.code).toBe('VIDEO_NOT_FOUND');
          expect(res.body.message).toBe('Media not found');

          const rows = await db
            .select({ id: metaAd.id })
            .from(metaAd)
            .where(eq(metaAd.organizationId, owner.organizationId));
          expect(rows).toHaveLength(0);
        }
      );
    });

    it('rejects duplicate or foreign service IDs at the boundary without writing a partial draft', async () => {
      // `meta_ad_service` rejects duplicate pairs and foreign service IDs are
      // never valid for this org. Both used to reach the DB write path, where
      // a constraint failure could become an assistant-chat 500/Sentry error.
      const owner = await seedOrgWithMember('admin');
      const otherOrg = await seedOrgWithMember('admin');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const ownService = await uniqueService(owner.organizationId);
      const foreignService = await uniqueService(otherOrg.organizationId);

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          for (const serviceIds of [
            [ownService, ownService],
            [foreignService],
          ]) {
            const res = await request(server)
              .post('/meta-ads')
              .send({
                metaCampaignId: `camp_${randomUUID()}`,
                videoId,
                name: 'Invalid service selection',
                serviceIds,
              });
            expect(res.status).toBe(BAD_REQUEST);
            expect(res.body.code).toBe('VALIDATION_ERROR');
            expect(res.body.message).toMatch(/service/i);
          }
        }
      );

      const rows = await db
        .select({ id: metaAd.id })
        .from(metaAd)
        .where(eq(metaAd.organizationId, owner.organizationId));
      expect(rows).toHaveLength(0);
    });

    it('rejects a body with no serviceIds → 400 from the BOUNDARY pipe, with no `code`', async () => {
      // This pin is CORRECTED, and the correction is a finding.
      //
      // It used to assert `res.body.code === 'VALIDATION_ERROR'`, described as
      // "the structured error body the controller builds ({message, code,
      // details?}) — the frontend branches on `code`". That body was an
      // ARTEFACT OF THE HARNESS. `main.ts` registers nestjs-zod's
      // `ZodValidationPipe` globally, so in production this payload is rejected
      // at the BOUNDARY and never reaches the controller's mapper. The harness
      // registered only the stock class-validator `ValidationPipe`, which finds
      // no constraints on a `createZodDto` and validates nothing — so the
      // request fell through to the service's safeParse and produced a body
      // production has never sent for this case.
      //
      // So: the frontend's `code` branch is dead for boundary-rejected payloads,
      // and has been. That is worth knowing and is why this assertion is now
      // written against what the wire actually carries.
      //
      // The 400 itself is unchanged. Only the shape was ever wrong.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads')
            .send({
              metaCampaignId: `camp_${randomUUID()}`,
              videoId,
              name: 'No services',
            });
          expect(res.status).toBe(BAD_REQUEST);
          expect(res.body.code).toBeUndefined();
          expect(res.body.message).toBe('Validation failed');
          // The zod issues ARE carried, which is what a client can act on.
          expect(Array.isArray(res.body.errors)).toBe(true);
          expect(JSON.stringify(res.body.errors)).toMatch(/serviceIds/);
        }
      );
    });

    it('replaceCampaignDrafts deletes the campaign’s existing DRAFTS but spares launching ads and other campaigns', async () => {
      // PROTECTS: the rebuild-replaces-drafts rule. Getting this wrong either
      // stacks duplicate ads (budget split) or deletes live ads.
      const owner = await seedOrgWithMember('owner');
      const campaignId = `camp_${randomUUID()}`;
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const svcA = await uniqueService(owner.organizationId);

      const oldDraft = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        name: 'old draft',
      });
      const launching = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        name: 'launching',
        status: 'launching',
      });
      const otherCampaignDraft = await seedAd({
        organizationId: owner.organizationId,
        name: 'other campaign draft',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads')
            .send({
              metaCampaignId: campaignId,
              videoId,
              name: 'rebuilt',
              serviceIds: [svcA],
              replaceCampaignDrafts: true,
            });
          expect(res.status).toBe(CREATED);

          expect(
            await db.query.metaAd.findFirst({ where: eq(metaAd.id, oldDraft) })
          ).toBeUndefined();
          expect(
            (
              await db.query.metaAd.findFirst({
                where: eq(metaAd.id, launching),
              })
            )?.name
          ).toBe('launching');
          expect(
            (
              await db.query.metaAd.findFirst({
                where: eq(metaAd.id, otherCampaignDraft),
              })
            )?.name
          ).toBe('other campaign draft');
        }
      );
    });
  });

  describe('PUT /meta-ads/:id (update)', () => {
    it('updates an unpublished draft locally and leaves untouched fields alone', async () => {
      // PROTECTS: the local half of updateAd — for an ad with no metaAdId the
      // service returns straight after the DB write, no Meta call. Read back
      // from Postgres.
      const owner = await seedOrgWithMember('owner');
      const adId = await seedAd({
        organizationId: owner.organizationId,
        name: 'Before',
        headline: 'Original headline',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/meta-ads/${adId}`)
            .send({ name: 'After', callToAction: 'BOOK_NOW' });
          expect(res.status).toBe(OK);

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, adId),
          });
          expect(row?.name).toBe('After');
          expect(row?.callToAction).toBe('BOOK_NOW');
          expect(row?.headline).toBe('Original headline');
          expect(row?.status).toBe('draft');
        }
      );
    });

    it('updating an ad in ANOTHER org → 404 and that row is untouched', async () => {
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('owner');
      const bAd = await seedAd({
        organizationId: orgB.organizationId,
        name: 'B ad',
      });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/meta-ads/${bAd}`)
            .send({ name: 'hijacked' });
          expect(res.status).toBe(NOT_FOUND);

          const row = await db.query.metaAd.findFirst({
            where: and(
              eq(metaAd.id, bAd),
              eq(metaAd.organizationId, orgB.organizationId)
            ),
          });
          expect(row?.name).toBe('B ad');
        }
      );
    });
  });

  describe('PUT /meta-ads/:id/creative (replace creative)', () => {
    it('swaps the creative on an unpublished Borradh draft and clears the other creative column', async () => {
      // PROTECTS: replacing a video with a graphic must NULL the video column
      // (an ad carries exactly one creative). Read back from Postgres.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const graphicId = await seedGraphic({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        outputUrl: FBCDN_URL,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/meta-ads/${adId}/creative`)
            .send({ graphicId });
          expect(res.status).toBe(OK);

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, adId),
          });
          expect(row?.graphicId).toBe(graphicId);
          expect(row?.videoId).toBeNull();
        }
      );
    });

    it('refuses to replace the creative on a non-draft ad → 400 INVALID_AD_STATE', async () => {
      const owner = await seedOrgWithMember('owner');
      const graphicId = await seedGraphic({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        outputUrl: FBCDN_URL,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        status: 'launching',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/meta-ads/${adId}/creative`)
            .send({ graphicId });
          expect(res.status).toBe(BAD_REQUEST);
          expect(res.body.code).toBe('INVALID_AD_STATE');
        }
      );
    });

    it('requires exactly one creative — sending both → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      const adId = await seedAd({ organizationId: owner.organizationId });
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const graphicId = await seedGraphic({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        outputUrl: FBCDN_URL,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .put(`/meta-ads/${adId}/creative`)
            .send({ videoId, graphicId });
          expect(res.status).toBe(BAD_REQUEST);
        }
      );
    });
  });

  describe('POST /meta-ads/:id/duplicate', () => {
    it('clones a locally-owned ad as a fresh DRAFT with a " (Copy)" name and its services', async () => {
      // PROTECTS: the local-duplicate branch (source has a local creative → no
      // Meta /copies call). The clone must be a NEW draft row, not imported,
      // and must carry the source's service links.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
      });
      const svcA = await uniqueService(owner.organizationId);
      const sourceId = await seedAd({
        organizationId: owner.organizationId,
        name: 'Original',
        videoId,
        headline: 'Same headline',
      });
      await db
        .insert(metaAdService)
        .values({ metaAdId: sourceId, serviceId: svcA });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(
            `/meta-ads/${sourceId}/duplicate`
          );
          expect(res.status).toBe(CREATED);
          const copyId: string = res.body.id;
          expect(copyId).not.toBe(sourceId);

          const copy = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, copyId),
          });
          expect(copy?.name).toBe('Original (Copy)');
          expect(copy?.status).toBe('draft');
          expect(copy?.isImported).toBe(false);
          expect(copy?.videoId).toBe(videoId);
          expect(copy?.headline).toBe('Same headline');
          expect(copy?.organizationId).toBe(owner.organizationId);
          expect(await adServiceIds(copyId)).toEqual([svcA]);

          // The source is untouched.
          const source = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, sourceId),
          });
          expect(source?.name).toBe('Original');
        }
      );
    });

    it('duplicating an ad in ANOTHER org → 404 AD_NOT_FOUND', async () => {
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('owner');
      const bAd = await seedAd({ organizationId: orgB.organizationId });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server).post(`/meta-ads/${bAd}/duplicate`);
          expect(res.status).toBe(NOT_FOUND);
          expect(res.body.code).toBe('AD_NOT_FOUND');
        }
      );
    });
  });

  describe('DELETE /meta-ads/:id', () => {
    it('deletes the local row (and its junction) and returns { success: true }', async () => {
      // PROTECTS: the controller's hand-built response body — the service
      // returns { deleted: true }, the controller replaces it with
      // { success: true }. Also pins the FK cascade of the service junction.
      const owner = await seedOrgWithMember('owner');
      const svcA = await uniqueService(owner.organizationId);
      const adId = await seedAd({ organizationId: owner.organizationId });
      await db
        .insert(metaAdService)
        .values({ metaAdId: adId, serviceId: svcA });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).delete(`/meta-ads/${adId}`);
          expect(res.status).toBe(OK);
          expect(res.body).toEqual({ success: true });

          expect(
            await db.query.metaAd.findFirst({ where: eq(metaAd.id, adId) })
          ).toBeUndefined();
          expect(await adServiceIds(adId)).toEqual([]);

          const gone = await request(server).get(`/meta-ads/${adId}`);
          expect(gone.status).toBe(NOT_FOUND);
        }
      );
    });

    it('deleting an ad in ANOTHER org → 404 and the row SURVIVES', async () => {
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('owner');
      const bAd = await seedAd({ organizationId: orgB.organizationId });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const res = await request(server).delete(`/meta-ads/${bAd}`);
          expect(res.status).toBe(NOT_FOUND);
          expect(
            (await db.query.metaAd.findFirst({ where: eq(metaAd.id, bAd) }))?.id
          ).toBe(bAd);
        }
      );
    });
  });

  describe('GET /meta-ads/campaigns/:metaCampaignId (list)', () => {
    it('returns only that campaign’s ads for the active org, in a { ads, total } envelope', async () => {
      const owner = await seedOrgWithMember('owner');
      const other = await seedOrgWithMember('owner');
      const campaignId = `camp_${randomUUID()}`;

      const mine = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        name: 'mine',
      });
      const otherCampaign = await seedAd({
        organizationId: owner.organizationId,
        name: 'other campaign',
      });
      const otherOrgSameCampaign = await seedAd({
        organizationId: other.organizationId,
        metaCampaignId: campaignId,
        name: 'other org',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get(
            `/meta-ads/campaigns/${campaignId}`
          );
          expect(res.status).toBe(OK);
          const ids = (res.body.ads as Array<{ id: string }>).map((a) => a.id);
          expect(ids).toEqual([mine]);
          expect(ids).not.toContain(otherCampaign);
          expect(ids).not.toContain(otherOrgSameCampaign);
          // The envelope is { ads, total } — NOTE it carries no limit/offset,
          // unlike the assets list envelope. `total` is a real COUNT(*) of
          // matching rows (not the page length).
          expect(res.body.total).toBe(1);
          expect('limit' in res.body).toBe(false);
          expect('offset' in res.body).toBe(false);
        }
      );
    });

    it('honours ?status and ?limit from the query DTO, with total unaffected by the page cap', async () => {
      const owner = await seedOrgWithMember('owner');
      const campaignId = `camp_${randomUUID()}`;
      const draftAd = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        name: 'draft one',
      });
      const launchingAd = await seedAd({
        organizationId: owner.organizationId,
        metaCampaignId: campaignId,
        name: 'launching one',
        status: 'launching',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const drafts = await request(server).get(
            `/meta-ads/campaigns/${campaignId}?status=draft`
          );
          expect(drafts.status).toBe(OK);
          expect(
            (drafts.body.ads as Array<{ id: string }>).map((a) => a.id)
          ).toEqual([draftAd]);

          const paged = await request(server).get(
            `/meta-ads/campaigns/${campaignId}?limit=1`
          );
          expect(paged.status).toBe(OK);
          expect(paged.body.ads).toHaveLength(1);
          // `total` stays the full match count even when the page is capped.
          expect(paged.body.total).toBe(2);

          // Both ads exist; the filter above is what narrowed the first result.
          const all = await request(server).get(
            `/meta-ads/campaigns/${campaignId}`
          );
          expect(
            (all.body.ads as Array<{ id: string }>).map((a) => a.id).sort()
          ).toEqual([draftAd, launchingAd].sort());
        }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* 4. The live-Meta boundary — pinned UP TO the credential check.    */
  /* ---------------------------------------------------------------- */
  describe('routes that need live Meta (pinned up to the credential boundary)', () => {
    it('GET /meta-ads/health-check → 412 META_NOT_CONFIGURED when the org has no Meta integration', async () => {
      // PROTECTS: the META_NOT_CONFIGURED → PRECONDITION_FAILED mapping, which
      // is what the frontend uses to render "connect Meta". Beyond this point
      // the handler needs the Graph API and is covered by the staging E2E.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).get('/meta-ads/health-check');
          expect(res.status).toBe(PRECONDITION_FAILED);
          expect(res.body.code).toBe('META_NOT_CONFIGURED');
        }
      );
    });

    it('POST /meta-ads/import → 412 META_NOT_CONFIGURED and imports nothing', async () => {
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post('/meta-ads/import');
          expect(res.status).toBe(PRECONDITION_FAILED);
          expect(res.body.code).toBe('META_NOT_CONFIGURED');

          const rows = await db
            .select({ id: metaAd.id })
            .from(metaAd)
            .where(eq(metaAd.organizationId, owner.organizationId));
          expect(rows).toHaveLength(0);
        }
      );
    });

    it('POST /meta-ads/:id/publish with an unrendered video → 400 VIDEO_NOT_READY (media check precedes credentials)', async () => {
      // PROTECTS the ORDER of publishAd's pre-flight checks: media readiness is
      // resolved BEFORE Meta credentials, so an operator publishing too early
      // is told "video is still processing", not "connect Meta".
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        status: 'draft',
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/meta-ads/${adId}/publish`);
          expect(res.status).toBe(BAD_REQUEST);
          expect(res.body.code).toBe('VIDEO_NOT_READY');

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, adId),
          });
          expect(row?.status).toBe('draft');
        }
      );
    });

    it('POST /meta-ads/:id/publish with a READY video → 412 META_NOT_CONFIGURED, and the ad stays a draft', async () => {
      // This is the last deterministic step before the Graph API call: media
      // resolved, credentials missing. Anything past here needs staging.
      const owner = await seedOrgWithMember('owner');
      const videoId = await seedVideo({
        organizationId: owner.organizationId,
        createdById: owner.userId,
        status: 'ready',
        blobUrl: `${S3_HOST}/videos/ready.mp4`,
      });
      const adId = await seedAd({
        organizationId: owner.organizationId,
        videoId,
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/meta-ads/${adId}/publish`);
          expect(res.status).toBe(PRECONDITION_FAILED);
          expect(res.body.code).toBe('META_NOT_CONFIGURED');

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, adId),
          });
          expect(row?.status).toBe('draft');
          expect(row?.metaAdId).toBeNull();
        }
      );
    });

    it('POST /meta-ads/:id/publish on a NON-draft → 400 INVALID_AD_STATE (checked before any Meta call)', async () => {
      const owner = await seedOrgWithMember('owner');
      const adId = await seedAd({
        organizationId: owner.organizationId,
        status: 'launching',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/meta-ads/${adId}/publish`);
          expect(res.status).toBe(BAD_REQUEST);
          expect(res.body.code).toBe('INVALID_AD_STATE');
        }
      );
    });

    it('POST /meta-ads/:id/sync on an ad never published to Meta → 400 INVALID_AD_STATE', async () => {
      const owner = await seedOrgWithMember('owner');
      const adId = await seedAd({ organizationId: owner.organizationId });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(`/meta-ads/${adId}/sync`);
          expect(res.status).toBe(BAD_REQUEST);
          expect(res.body.code).toBe('INVALID_AD_STATE');
          expect(res.body.message).toBe('Ad not published to Meta');
        }
      );
    });

    it('POST /meta-ads/:id/sync on a NON-EXISTENT id → 404 AD_NOT_FOUND', async () => {
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post('/meta-ads/ad_nope/sync');
          expect(res.status).toBe(NOT_FOUND);
          expect(res.body.code).toBe('AD_NOT_FOUND');
        }
      );
    });

    it('POST /meta-ads/:id/sync on ANOTHER org’s unpublished ad → the SAME 404 as a nonexistent id', async () => {
      // This pin is INVERTED. It used to assert 400 and name itself a
      // "documented leak": `syncFromMeta` checked `!ad.metaAdId` BEFORE the
      // organization check, so an org-A caller could tell "this id exists in
      // some other org" (400 INVALID_AD_STATE) from "this id does not exist"
      // (404) — an id-enumeration oracle, one guess at a time.
      //
      // The org check now runs first. The assertion is deliberately written as
      // "the SAME response as the nonexistent-id test above": that pairing is
      // the property. A response that is merely 404 but carries a different
      // code or body would still be an oracle.
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bAd = await seedAd({ organizationId: orgB.organizationId });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const foreign = await request(server).post(`/meta-ads/${bAd}/sync`);
          const nonexistent = await request(server).post(
            '/meta-ads/ad_nope/sync'
          );

          expect(foreign.status).toBe(NOT_FOUND);
          expect(foreign.body.code).toBe('AD_NOT_FOUND');
          // Indistinguishable, which is the whole point.
          expect(foreign.status).toBe(nonexistent.status);
          expect(foreign.body).toEqual(nonexistent.body);
        }
      );
    });

    it('POST /meta-ads/launch with an empty body → 400 at the boundary pipe (no Meta call attempted)', async () => {
      const owner = await seedOrgWithMember('admin');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post('/meta-ads/launch').send({});
          expect(res.status).toBe(BAD_REQUEST);
          // Rejected at the boundary (see the note on the create test above),
          // so there is no controller-built `code`.
          expect(res.body.message).toBe('Validation failed');
        }
      );
    });

    it('POST /meta-ads/launch-from-post with an empty body → 400 at the boundary pipe', async () => {
      const owner = await seedOrgWithMember('admin');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads/launch-from-post')
            .send({});
          expect(res.status).toBe(BAD_REQUEST);
          // Rejected at the boundary (see the note on the create test above),
          // so there is no controller-built `code`.
          expect(res.body.message).toBe('Validation failed');
        }
      );
    });
  });

  describe('POST /meta-ads/:id/promote-draft', () => {
    it('a draft in another org (or a bogus id) → 404 NOT_FOUND', async () => {
      const orgA = await seedOrgWithMember('admin');
      const orgB = await seedOrgWithMember('owner');
      const bDraft = await seedAd({ organizationId: orgB.organizationId });

      await withApp(
        { userId: orgA.userId, organizationId: orgA.organizationId },
        async (server) => {
          const cross = await request(server).post(
            `/meta-ads/${bDraft}/promote-draft`
          );
          expect(cross.status).toBe(NOT_FOUND);

          const bogus = await request(server).post(
            '/meta-ads/ad_nope/promote-draft'
          );
          expect(bogus.status).toBe(NOT_FOUND);
        }
      );
    });

    it('an incomplete draft (no creative) → 400 with an actionable message', async () => {
      // This pin is INVERTED. It used to assert 500 and flag why: `promoteDraftAd`
      // returns `ErrorCodes.INVALID_STATE` for its user-actionable pre-flight
      // failures ("missing a creative / targeting / serviceIds", "already
      // promoted"), and INVALID_STATE was absent from the statusMap, so the
      // `?? INTERNAL_SERVER_ERROR` default turned every one of them into a 500.
      //
      // That mattered beyond the status code: `sanitize-errors.filter.ts` scrubs
      // the body on any status >= 500, in EVERY environment — so the owner was
      // shown "Internal server error" for something they could have fixed in ten
      // seconds. The assertion on the message below is the real point of this
      // test; the 400 is just what stops it being scrubbed.
      //
      // The draft must still remain untouched.
      const owner = await seedOrgWithMember('admin');
      const draftId = await seedAd({
        organizationId: owner.organizationId,
        name: 'Incomplete draft',
      });

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server).post(
            `/meta-ads/${draftId}/promote-draft`
          );
          expect(res.status).toBe(BAD_REQUEST);
          // Survives the sanitize filter, and actually says what to do.
          expect(JSON.stringify(res.body)).toMatch(/creative/i);

          const row = await db.query.metaAd.findFirst({
            where: eq(metaAd.id, draftId),
          });
          expect(row?.name).toBe('Incomplete draft');
          expect(row?.status).toBe('draft');
        }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* 5. Cross-cutting gates.                                           */
  /* ---------------------------------------------------------------- */
  describe('active-organization gate + webhook', () => {
    it('authenticated routes 400 with "No active organization selected" when no org is active', async () => {
      // PROTECTS: `requireActiveOrganization`. NOTE the ordering: on the
      // admin-gated POST, RoleGuard runs FIRST and 403s (it needs an org too),
      // so only the ungated routes surface the 400.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: undefined },
        async (server) => {
          const health = await request(server).get('/meta-ads/health-check');
          expect(health.status).toBe(BAD_REQUEST);
          expect(health.body.message).toBe('No active organization selected');

          const one = await request(server).get('/meta-ads/whatever');
          expect(one.status).toBe(BAD_REQUEST);

          const created = await request(server).post('/meta-ads').send({});
          expect(created.status).toBe(FORBIDDEN);
        }
      );
    });

    it('POST /meta-ads/webhook without an x-hub-signature-256 header → 400 "Missing signature"', async () => {
      // PROTECTS: the @Public() webhook's first guard clause, which runs before
      // the app-secret check and before any DB work. It writes the response via
      // @Res(), so this also pins that the handler still returns a body.
      const owner = await seedOrgWithMember('owner');

      await withApp(
        { userId: owner.userId, organizationId: owner.organizationId },
        async (server) => {
          const res = await request(server)
            .post('/meta-ads/webhook')
            .send({ object: 'page', entry: [] });
          expect(res.status).toBe(BAD_REQUEST);
          expect(res.text).toBe('Missing signature');
        }
      );
    });
  });
});

/*
 * FINDINGS (reported, deliberately NOT fixed here):
 *
 *  1. ORG-ENUMERATION ORACLE on POST /meta-ads/:id/sync. FIXED — the
 *     organization check now runs BEFORE the `!ad.metaAdId` check, so a
 *     foreign ad is indistinguishable from a nonexistent one, matching every
 *     sibling route. The pin above is inverted and now asserts the two
 *     responses are byte-identical.
 *  2. INVALID_STATE → 500. FIXED — INVALID_STATE now maps to 400 here and in
 *     the four other controllers reachable from an INVALID_STATE-emitting
 *     feature area (offers, organization-services, graphics, public-booking).
 *     The pin above is inverted and now asserts the message survives.
 *  3. SHAPE ASYMMETRY between the two read routes: GET /meta-ads/:id returns
 *     `video.blobUrl`, GET /meta-ads/campaigns/:id returns `video.videoUrl`,
 *     for the same underlying column. Pinned above so the refactor cannot
 *     "tidy" one of them without a conscious decision.
 */
