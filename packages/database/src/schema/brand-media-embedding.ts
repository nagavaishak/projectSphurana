import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  vector,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { metaAdsPage } from './meta-ads-pages.js';
import { organization } from './organization.js';

// =============================================================================
// TABLES
// =============================================================================

/**
 * BrandMediaEmbedding — the per-org "brand corpus" backing AI branded-graphic
 * generation (GRAPHICS_ENGINE='nano-banana'). One row per published social
 * media item (Facebook Page post / Instagram media) we've pulled + analysed.
 *
 * Each row caches the item's caption + media URL alongside a Claude
 * vision-distilled `description` (what the graphic visually IS) and a coarse
 * `format` tag, plus a 1536-d embedding of that description. At generation
 * time we embed the topic and cosine-retrieve the most stylistically similar
 * past items as STYLE references for the image model.
 *
 * Media-generic by design (`mediaType`, `platform`, `mediaUrl`,
 * `thumbnailUrl`) so the same corpus can hold video history when the video
 * engine grows a brand-style feature — no migration churn. v1 only ingests +
 * retrieves `mediaType='image'`; video rows are reserved for a follow-up.
 *
 * Built once per org as a resilient background job (bounded concurrency +
 * 429 backoff — vision-describing hundreds of items would otherwise rate
 * limit), then refreshed on a TTL. Re-pulls dedupe by `postId` (unique per
 * org) so steady-state only describes net-new items.
 *
 * `embedding` is the embedding of the TEXT `description` (uniform 1536-d for
 * both image and describe-then-embed video). A native video-understanding
 * model (e.g. Twelve Labs Marengo) emits a different fixed dimension, so when
 * we adopt one it gets its OWN nullable column (`native_embedding`) rather
 * than overloading this one — pgvector columns are fixed-width.
 *
 * Requires pgvector (already enabled — see `voice_embedding`).
 */
export const brandMediaEmbedding = pgTable(
  'brand_media_embedding',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Which FB page this item came from (also the link for page-attached IG).
    // Nullable so a page swap doesn't orphan the corpus, but set when known.
    metaAdsPageId: text('meta_ads_page_id').references(() => metaAdsPage.id, {
      onDelete: 'set null',
    }),

    // 'facebook' | 'instagram' — which surface the item was published on.
    platform: text('platform')
      .$type<'facebook' | 'instagram'>()
      .notNull()
      .default('facebook'),
    // 'image' | 'video'. v1 only ingests + retrieves images; video reserved.
    mediaType: text('media_type')
      .$type<'image' | 'video'>()
      .notNull()
      .default('image'),

    // Platform post/media id — the dedupe key for incremental re-pulls.
    postId: text('post_id').notNull(),

    // Raw fields (kept so we can pass the image as a style reference and
    // surface the permalink for debugging without re-hitting the Graph API).
    caption: text('caption').notNull().default(''),
    // The full-res media URL (image bitmap, or video file for video rows).
    mediaUrl: text('media_url').notNull(),
    // A still to use as the reference frame — equals mediaUrl for images,
    // the poster/thumbnail for videos.
    thumbnailUrl: text('thumbnail_url'),
    permalink: text('permalink').notNull().default(''),

    /**
     * Key of OUR OWN copy of the image in the org-assets bucket — the only
     * durable pointer to it.
     *
     * `mediaUrl` / `thumbnailUrl` are Meta `fbcdn` URLs: signed, and dead in
     * about a week. A prod probe found 2,456 of 2,473 rows (99.3%) no longer
     * resolved, which meant the brand reference silently stopped reaching the
     * image model for every org whose corpus was more than a few days old.
     * Readers must prefer this key and treat the raw URLs as a best-effort
     * fallback for rows written before the copy existed.
     */
    objectKey: text('object_key'),

    /**
     * Perceptual hash (dHash) of the stored image. A post published to both the
     * Facebook page and Instagram arrives as two rows with different `postId`s
     * and near-identical bitmaps — 29 of 71 items for one org. Selection
     * dedupes on this so an org's inspiration set isn't three copies of one
     * post.
     */
    dhash: text('dhash'),

    // Claude vision analysis (of the still).
    description: text('description').notNull().default(''),
    format: text('format').notNull().default('other'),

    /**
     * Cached verdict from the inspiration gate, so choosing an org's reference
     * set is a query rather than a fresh round of vision calls — which also
     * makes the choice deterministic between runs.
     */
    inspirationVerdict: jsonb('inspiration_verdict').$type<{
      /** What the image IS: a designed graphic, a plain photo, a screenshot… */
      kind: string;
      /** A photo with a logo watermark is NOT a design. */
      isDesign: boolean;
      /** Closed vocabulary — free text fragments one house style many ways. */
      colourway: string;
      /** Closed vocabulary. Colour says what a post looks like, not how it is built. */
      layout: string;
      /** `colourway|layout` — the grouping key for "posts of one visual system". */
      designFamily: string;
      usable: boolean;
      /**
       * Whether the mark in this post matches the org's UPLOADED logo.
       *
       * A post carrying a different lockup — a sub-brand, a retired mark —
       * teaches the model the wrong logo. Optional: rows gated before this
       * existed have no value, and an org with no logo has nothing to compare.
       */
      logoMatch?: 'match' | 'different' | 'absent';
      /**
       * 0-5: how good this post is AS A DESIGN TO IMITATE.
       *
       * `usable` is a blacklist of anticipated genres, so anything nobody
       * enumerated passes — an awards plea and an event announcement both did,
       * and became two of three references behind a day of poor renders.
       * Optional: rows gated before scoring existed have none, and a missing
       * score must not read as zero.
       */
      suitability?: number;
      reason?: string;
    }>(),
    gatedAt: timestamp('gated_at'),

    /**
     * OpenAI text-embedding-3-small (1536d) of the distilled description.
     *
     * NULLABLE since reference selection stopped being a topic-cosine lookup:
     * an item only needs an embedding if something still retrieves it that way,
     * and describing + embedding every item was the expensive half of ingest.
     */
    embedding: vector('embedding', { dimensions: 1536 }),

    // When the original item was published (Graph API `created_time` /
    // `timestamp`).
    postedAt: timestamp('posted_at'),

    metadata: jsonb('metadata').$type<{ topics?: string[] }>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_brand_media_embedding_org_id').on(table.organizationId),
    unique('uq_brand_media_embedding_org_post').on(
      table.organizationId,
      table.postId
    ),
    index('idx_brand_media_embedding_vector').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    // Selection reads an org's gated items newest-first.
    index('idx_brand_media_embedding_org_posted').on(
      table.organizationId,
      table.postedAt
    ),
  ]
);

export const brandMediaEmbeddingRlsPolicy = orgRlsPolicy(brandMediaEmbedding);

// =============================================================================
// RELATIONS
// =============================================================================

export const brandMediaEmbeddingRelations = relations(
  brandMediaEmbedding,
  ({ one }) => ({
    organization: one(organization, {
      fields: [brandMediaEmbedding.organizationId],
      references: [organization.id],
    }),
    metaAdsPage: one(metaAdsPage, {
      fields: [brandMediaEmbedding.metaAdsPageId],
      references: [metaAdsPage.id],
    }),
  })
);

// =============================================================================
// TYPES
// =============================================================================

export type BrandMediaEmbedding = typeof brandMediaEmbedding.$inferSelect;
export type NewBrandMediaEmbedding = typeof brandMediaEmbedding.$inferInsert;
