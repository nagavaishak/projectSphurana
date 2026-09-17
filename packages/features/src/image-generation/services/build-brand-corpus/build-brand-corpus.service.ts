/**
 * `buildBrandCorpus` — build / refresh an org's "brand corpus".
 *
 * Pipeline (Facebook + Instagram, images only for v1):
 *   1. pull the org's published media (`fetchPageMedia`)
 *   2. split into NEW posts and KNOWN posts we hold no image bytes for
 *   3. copy every one of those images into our own bucket and hash it
 *   4. upsert rows into `brand_media_embedding`
 *
 * The copy in step 3 is the whole point. Meta's `fbcdn` URLs are signed and
 * expire in about a week, and this job used to store them verbatim and never
 * rewrite them — so 99.3% of production rows ended up pointing at images that
 * no longer loaded, and generation silently ran with no brand reference.
 *
 * Deliberately does NOT vision-describe or embed each item any more. Nothing
 * retrieves by cosine similarity now that references are chosen by
 * `selectInspirationSet`, which classifies eight images per call and caches the
 * verdict — so a per-item vision call would be most of the cost of a rebuild,
 * spent on data no reader consumes.
 *
 * Still a BACKGROUND job: it downloads and re-encodes every image.
 */

import { brandMediaEmbedding, organization } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { getOrgAssetsBucket, upload } from '@borradh-workspace/storage';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type PageMediaItem,
  fetchPageMedia,
} from '../../../social-posts/services/fetch-page-media/index.js';
import { computeDhash } from '../../dhash.js';
import {
  type BuildBrandCorpusInput,
  buildBrandCorpusSchema,
} from './build-brand-corpus.schema.js';

/**
 * Longest-edge px for the copy we STORE. Larger than the vision thumbnail
 * because this one is handed to the image model as a brand reference, where
 * typography and logo detail have to survive.
 */
const STORED_MAX_EDGE = 1280;

export interface BuildBrandCorpusOutput {
  pulled: number;
  inserted: number;
  skippedExisting: number;
  failed: number;
  /** Existing rows whose image bytes we copied into our own bucket this run. */
  repaired: number;
  /** Items whose bytes we could not persist — usually an expired CDN URL. */
  unpersistable: number;
}

const log = createLogger('buildBrandCorpus');

/**
 * Copy an item's image into the org-assets bucket and hash it.
 *
 * THE POINT OF THIS FUNCTION. `mediaUrl` is a Meta `fbcdn` URL: signed, and
 * dead in about a week. The corpus stored those URLs and never refreshed them,
 * so 99.3% of production rows pointed at images that no longer loaded — and
 * because the consumer swallowed the fetch failure, generation silently ran
 * with no brand reference at all. Our own copy is the fix; everything else here
 * is bookkeeping around it.
 *
 * Best-effort: an item we cannot persist is still worth keeping as a row (the
 * caption alone seeds caption generation), so this returns nulls rather than
 * throwing.
 */
async function persistImage(
  organizationId: string,
  item: PageMediaItem
): Promise<{ objectKey: string | null; dhash: string | null }> {
  const sourceUrl = item.thumbnailUrl || item.mediaUrl;
  const objectKey = `${organizationId}/brand-inspiration/${item.id}.jpg`;
  try {
    // ONE fetch: the hash and the stored object must describe the same bytes,
    // and a signed URL that works for the first request is not guaranteed to
    // work for a second.
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      log.warn('Brand image URL no longer resolves', {
        organizationId,
        postId: item.id,
        status: res.status,
      });
      return { objectKey: null, dhash: null };
    }
    const raw = Buffer.from(await res.arrayBuffer());

    // Normalise to JPEG so the stored object is predictable and small; these
    // are model inputs, not archival originals.
    const normalised = await sharp(raw)
      .resize(STORED_MAX_EDGE, STORED_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();

    await upload({
      bucket: getOrgAssetsBucket(),
      key: objectKey,
      body: normalised,
      contentType: 'image/jpeg',
    });

    return { objectKey, dhash: await computeDhash(normalised) };
  } catch (error) {
    // Expected for older posts whose signed URL has already expired. Counted
    // and logged rather than thrown: the org may still have newer posts we can
    // persist, and a hard failure here would lose those too.
    log.warn('Could not persist brand image — source URL is probably expired', {
      organizationId,
      postId: item.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { objectKey: null, dhash: null };
  }
}

/** Concurrency-bounded async map. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        out[idx] = await fn(items[idx], idx);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

const buildBrandCorpusImpl = async (
  db: DbConnection,
  input: BuildBrandCorpusInput
): Promise<Result<BuildBrandCorpusOutput>> => {
  const parsed = buildBrandCorpusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, limit, concurrency } = parsed.data;

  const mediaResult = await fetchPageMedia(db, { organizationId, limit });
  if (!mediaResult.success) {
    return err(mediaResult.error) as Result<BuildBrandCorpusOutput>;
  }
  // v1: images only. Video rows are reserved for a later video feature.
  const images = mediaResult.data.items.filter((i) => i.mediaType === 'image');

  // Best-effort: seed the org's brand FONT reference from the most text-heavy
  // post (longest caption is a decent proxy for a text-rich graphic), so the
  // AI graphic model gets a visual sample of their typography. Only sets it
  // when unset — never overrides a manually chosen one. Runs before the
  // dedupe early-return so it self-heals even on a no-new-posts re-run.
  await ensureBrandFontImage(db, organizationId, images);

  // What's already here, and — critically — whether we hold our own copy of
  // its bytes. A row we already know about is NOT automatically done: if it
  // predates the durable copy, its `mediaUrl` has since expired and it is
  // useless as a reference until repaired.
  const existing = await db
    .select({
      postId: brandMediaEmbedding.postId,
      objectKey: brandMediaEmbedding.objectKey,
    })
    .from(brandMediaEmbedding)
    .where(eq(brandMediaEmbedding.organizationId, organizationId));
  const existingByPostId = new Map(existing.map((r) => [r.postId, r]));

  const fresh = images.filter((i) => !existingByPostId.has(i.id));
  // Known posts still pointing at a CDN URL instead of our own object. This
  // set is what the write-once corpus could never act on: the old code
  // filtered these out as "already have it" and returned early.
  const repairable = images.filter(
    (i) => existingByPostId.has(i.id) && !existingByPostId.get(i.id)?.objectKey
  );

  if (fresh.length === 0 && repairable.length === 0) {
    return ok({
      pulled: images.length,
      inserted: 0,
      skippedExisting: images.length,
      failed: 0,
      repaired: 0,
      unpersistable: 0,
    });
  }

  // Repair first and independently of the vision work: these rows already have
  // a description and an embedding, so all they need is durable bytes. Keeping
  // them off the describe path is what makes repairing a 150-item corpus cost
  // a few seconds of downloads rather than 150 vision calls.
  let repaired = 0;
  let unpersistable = 0;
  if (repairable.length > 0) {
    log.info('Repairing brand-corpus rows with no durable copy', {
      organizationId,
      count: repairable.length,
    });
    const persisted = await mapLimit(repairable, concurrency, (item) =>
      persistImage(organizationId, item)
    );
    await Promise.all(
      repairable.map(async (item, i) => {
        const { objectKey, dhash } = persisted[i];
        if (!objectKey) {
          unpersistable++;
          return;
        }
        await db
          .update(brandMediaEmbedding)
          .set({
            objectKey,
            dhash,
            // Refresh the raw URLs too: they are the fallback for anything
            // reading a row written before the copy existed.
            mediaUrl: item.mediaUrl,
            thumbnailUrl: item.thumbnailUrl,
            caption: item.caption,
          })
          .where(
            and(
              eq(brandMediaEmbedding.organizationId, organizationId),
              eq(brandMediaEmbedding.postId, item.id)
            )
          );
        repaired++;
      })
    );
  }

  if (fresh.length === 0) {
    return ok({
      pulled: images.length,
      inserted: 0,
      skippedExisting: images.length - repairable.length,
      failed: 0,
      repaired,
      unpersistable,
    });
  }

  // NO PER-ITEM VISION CALL, AND NO EMBEDDING.
  //
  // Ingest used to describe every item with a vision call and embed the
  // description, so that generation could cosine-retrieve a topically similar
  // past post. Nothing retrieves that way any more: references are chosen by
  // `selectInspirationSet`, which classifies EIGHT images per call and caches
  // the verdict. Keeping the old path would have meant one vision call and one
  // embedding per item for data no reader consumes — on the ~2,500 rows already
  // in production, most of the cost of a rebuild.
  //
  // `description` and `format` keep their column defaults; the gate's verdict is
  // a better record of what an image is than the prose was.
  const persistedFresh = await mapLimit(fresh, concurrency, (item) =>
    persistImage(organizationId, item)
  );
  unpersistable += persistedFresh.filter((p) => !p.objectKey).length;

  const pageId = await resolvePageRowId(db, organizationId);
  const rows = fresh.map((item, i) => ({
    organizationId,
    metaAdsPageId: item.platform === 'facebook' ? pageId : null,
    platform: item.platform,
    mediaType: item.mediaType,
    postId: item.id,
    caption: item.caption,
    mediaUrl: item.mediaUrl,
    thumbnailUrl: item.thumbnailUrl,
    objectKey: persistedFresh[i].objectKey,
    dhash: persistedFresh[i].dhash,
    permalink: item.permalink,
    postedAt: item.timestamp ? new Date(item.timestamp) : null,
  }));

  // UPDATE on conflict, not DO NOTHING.
  //
  // `onConflictDoNothing` is what made the corpus write-once: a post we already
  // knew about could never have its expired `mediaUrl` replaced, so a rebuild
  // discarded the very data it had just fetched to fix the problem. The unique
  // key is (organizationId, postId), so a conflict here means "we have this
  // post and just pulled fresher facts about it" — take them.
  //
  // `description`/`embedding`/`format` are deliberately NOT overwritten: they
  // cost a vision call to produce and do not go stale.
  await db
    .insert(brandMediaEmbedding)
    .values(rows)
    .onConflictDoUpdate({
      target: [brandMediaEmbedding.organizationId, brandMediaEmbedding.postId],
      set: {
        mediaUrl: sql`excluded.media_url`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        caption: sql`excluded.caption`,
        permalink: sql`excluded.permalink`,
        // COALESCE so a failed re-copy cannot null out a good stored object.
        objectKey: sql`COALESCE(excluded.object_key, ${brandMediaEmbedding.objectKey})`,
        dhash: sql`COALESCE(excluded.dhash, ${brandMediaEmbedding.dhash})`,
        updatedAt: new Date(),
      },
    });

  return ok({
    pulled: images.length,
    inserted: rows.length,
    skippedExisting: images.length - fresh.length - repairable.length,
    failed: 0,
    repaired,
    unpersistable,
  });
};

/**
 * Best-effort: set the org's `brandFontImageUrl` to its most text-heavy post
 * if not already set. The longest caption is a cheap proxy for a text-rich
 * graphic (a clean sample of their typography). Never overrides an existing
 * value. Failures are swallowed — a missing font ref just means the style
 * reference carries the typography instead.
 */
async function ensureBrandFontImage(
  db: DbConnection,
  organizationId: string,
  images: PageMediaItem[]
): Promise<void> {
  if (images.length === 0) return;
  try {
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { brandFontImageUrl: true },
    });
    if (org?.brandFontImageUrl) return; // respect an existing/manual value
    const best = [...images].sort(
      (a, b) => b.caption.length - a.caption.length
    )[0];
    if (!best) return;
    await db
      .update(organization)
      .set({ brandFontImageUrl: best.thumbnailUrl || best.mediaUrl })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );
  } catch {
    // best-effort only
  }
}

/** Best-effort: the org's default/active FB page row id, for attribution. */
async function resolvePageRowId(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  try {
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: e }) => e(t.organizationId, organizationId),
    });
    if (!integration) return null;
    const page = integration.defaultPageId
      ? await db.query.metaAdsPage.findFirst({
          where: (t, { eq: e, and: a }) =>
            a(
              e(t.metaAdsIntegrationId, integration.id),
              e(t.id, integration.defaultPageId as string)
            ),
        })
      : await db.query.metaAdsPage.findFirst({
          where: (t, { eq: e, and: a }) =>
            a(e(t.metaAdsIntegrationId, integration.id), e(t.isActive, true)),
        });
    return page?.id ?? null;
  } catch {
    return null;
  }
}

export const buildBrandCorpus = (
  db: DbConnection,
  input: BuildBrandCorpusInput
) =>
  trackedResult(
    'imageGeneration.buildBrandCorpus',
    () => buildBrandCorpusImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type BuildBrandCorpusResult = Awaited<
  ReturnType<typeof buildBrandCorpus>
>;
