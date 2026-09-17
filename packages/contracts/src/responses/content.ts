/**
 * Content response PROJECTIONS — hand-composed from generated atoms.
 *
 * Covers the six content surfaces owned by this domain:
 *   - social-posts   (scheduled / published Meta posts)
 *   - videos         (AI/organic video renders)
 *   - graphics       (branded-graphic / carousel renders)
 *   - assets         (uploaded media library + AI analysis)
 *   - content-batches(monthly bulk content review queue)
 *   - ai-content     (LLM copy generation — no backing table)
 *
 * Atoms are 1:1 with a DB table; the projections here are the real API
 * contract: list wrappers, detail shapes with joined creator/uploader/asset
 * relations, and hand-narrowed jsonb columns (the generator widens `$type<>()`
 * jsonb/text to `z.unknown()`/`z.string()` — we narrow them back here).
 *
 * Pure Zod, composed only with `z.object` / `.extend` / `z.array`. Media URLs
 * are plain strings; dates are ISO strings (atoms already wire-shaped). See
 * ./leads.ts and ./sales.ts for the pattern.
 */
import {
  assetContentTypeValues,
  placeholderTypeValues,
  socialPlatformValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  assetAnalysisAtomSchema,
  assetAtomSchema,
  contentBatchAtomSchema,
  contentItemAtomSchema,
  graphicAtomSchema,
  socialPostAtomSchema,
  videoAtomSchema,
} from '../generated/index.js';

// ============================================================================
// SOCIAL POSTS
// ============================================================================

/** Platform-specific publish settings (jsonb `$type<PlatformSettings>`). */
export const socialPlatformSettingsSchema = z.object({
  facebook: z.object({ pageId: z.string().optional() }).optional(),
  instagram: z.object({ accountId: z.string().optional() }).optional(),
});
export type SocialPlatformSettings = z.infer<
  typeof socialPlatformSettingsSchema
>;

/** Per-platform publish outcome (jsonb `$type<PlatformPublishResult[]>`). */
export const platformPublishResultSchema = z.object({
  platform: z.enum(socialPlatformValues),
  success: z.boolean(),
  postId: z.string().optional(),
  postUrl: z.string().optional(),
  error: z.string().optional(),
  publishedAt: z.string().optional(),
});
export type PlatformPublishResult = z.infer<typeof platformPublishResultSchema>;

/**
 * A social post row. The atom, with its jsonb columns hand-narrowed:
 * `mediaUrls` (carousel), `platforms`, `platformSettings`, `platformResults`.
 */
export const socialPostSchema = socialPostAtomSchema.extend({
  mediaUrls: z.array(z.string()).nullable(),
  platforms: z.array(z.enum(socialPlatformValues)),
  platformSettings: socialPlatformSettingsSchema.nullable(),
  platformResults: z.array(platformPublishResultSchema).nullable(),
});
export type SocialPost = z.infer<typeof socialPostSchema>;

/** `GET /social-posts` — list projection: `{ items, total, limit, offset }`. */
export const listSocialPostsResponseSchema = z.object({
  items: z.array(socialPostSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListSocialPostsResponse = z.infer<
  typeof listSocialPostsResponseSchema
>;

/** `POST /social-posts/sync` — the Meta reconciliation summary (no table). */
export const syncSocialPostsResponseSchema = z.object({
  checked: z.number(),
  deleted: z.number(),
  errors: z.number(),
});
export type SyncSocialPostsResponse = z.infer<
  typeof syncSocialPostsResponseSchema
>;

/** `GET /social-posts/:id/engagement` — live per-platform counters (no table). */
export const postEngagementSchema = z.object({
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  platform: z.enum(socialPlatformValues),
  postId: z.string(),
});
export type PostEngagement = z.infer<typeof postEngagementSchema>;

// ============================================================================
// VIDEOS
// ============================================================================

/** Minimal creator (team member) snapshot joined onto list/detail videos. */
export const videoCreatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type VideoCreator = z.infer<typeof videoCreatorSchema>;

/**
 * A raw video row (the atom, verbatim) as returned by create/update/delete.
 *
 * The render-config jsonb columns (`draftConfig`, `renderDoc`,
 * `synthesisOverrides`) model the entire video-template-engine document
 * (deeply nested, versioned) and the frontend consumes them opaquely. Rather
 * than mirror the huge engine types here, they are passed through as `z.any()`
 * (no runtime narrowing) so the projection stays assignable to the derived
 * api-client `Video` type, which types them as the concrete engine shapes.
 */
export const videoSchema = videoAtomSchema.extend({
  draftConfig: z.any(),
  renderDoc: z.any(),
  synthesisOverrides: z.any(),
});
export type Video = z.infer<typeof videoSchema>;

/** A video with its joined creator — the list/detail projection. */
export const videoWithCreatorSchema = videoSchema.extend({
  creator: videoCreatorSchema.nullable(),
});
export type VideoWithCreator = z.infer<typeof videoWithCreatorSchema>;

/**
 * `GET /videos/:id` — the detail projection.
 *
 * NOT `videoWithCreatorSchema`: `getVideo` hand-picks a narrower column set
 * than the atom (no `renderDoc`, `synthesisOverrides`, `usageType`,
 * `serviceId`, …), so the wider schema would assert fields the server never
 * sends. Picked from the generated atom, so a column rename fails the build.
 *
 * Nullable: the service returns `ok(row || null)` — a missing id is a `null`
 * body, not a 404.
 */
export const getVideoResponseSchema = videoAtomSchema
  .pick({
    id: true,
    title: true,
    status: true,
    progress: true,
    errorMessage: true,
    blobUrl: true,
    thumbnailUrl: true,
    durationMs: true,
    templateId: true,
    // The service the video promotes. Needed by any surface that scopes the
    // clip library to the treatment — without it the picker offers the whole
    // bank and the owner sorts through footage for services they did not ask
    // about.
    serviceId: true,
    organizationId: true,
    createdById: true,
    createdAt: true,
    updatedAt: true,
    exportedAt: true,
  })
  .extend({
    // Opaque for the same reason as `videoSchema.draftConfig` above — the
    // engine document is deeply nested and consumed as a whole.
    draftConfig: z.any(),
    creator: videoCreatorSchema.nullable(),
  })
  .nullable();
export type GetVideoResponse = z.infer<typeof getVideoResponseSchema>;

/**
 * `POST /upload/mobile-token` — a scoped token letting an unauthenticated
 * phone upload footage for one video (QR hand-off).
 */
export const createMobileUploadTokenResponseSchema = z.object({
  token: z.string(),
  deepLinkUrl: z.string(),
  expiresIn: z.number(),
});
export type CreateMobileUploadTokenResponse = z.infer<
  typeof createMobileUploadTokenResponseSchema
>;

/** `GET /videos` — list projection: `{ items, total, limit, offset }`. */
export const listVideosResponseSchema = z.object({
  items: z.array(videoWithCreatorSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListVideosResponse = z.infer<typeof listVideosResponseSchema>;

// ============================================================================
// GRAPHICS
// ============================================================================

/** A single rendered graphic export (jsonb `$type<GraphicOutput[]>`). */
export const graphicOutputSchema = z.object({
  aspectRatioId: z.string(),
  platform: z.string(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  format: z.enum(['png', 'jpg', 'webp']),
  renderedAt: z.string(),
  thumbnailUrl: z.string().optional(),
  slideId: z.string().optional(),
  slideOrder: z.number().optional(),
  objectKey: z.string().optional(),
  renderedBy: z.enum(['client', 'server']).optional(),
  status: z.enum(['success', 'failed']).optional(),
  error: z.string().optional(),
});
export type GraphicOutput = z.infer<typeof graphicOutputSchema>;

/**
 * A graphic row, with the `outputs` jsonb hand-narrowed to the rendered-export
 * shape. `GraphicWithTemplate` is an alias of the same shape backend-side.
 */
export const graphicSchema = graphicAtomSchema.extend({
  // The atom widens the `$type<'single' | 'carousel'>` text column to a bare
  // string; narrow it back to the union the api-client `Graphic` type expects.
  kind: z.enum(['single', 'carousel']),
  outputs: z.array(graphicOutputSchema).nullable(),
});
export type Graphic = z.infer<typeof graphicSchema>;

/**
 * `POST /graphics/generate` — the graphic, plus the item that owns it.
 *
 * Separate from `graphicSchema` because a non-strict Zod object STRIPS unknown
 * keys rather than passing them through: a caller parsing the create response
 * with the plain graphic schema silently loses `itemId` and then has to go find
 * the item another way. That "another way" was three tools reaching past HTTP
 * into the database. The video create returns the same field, for the same
 * reason — the item is what an edit addresses.
 */
export const generatedGraphicSchema = graphicSchema.extend({
  /** Null when the item could not be opened. The graphic still exists. */
  itemId: z.string().nullable().optional(),
  /** Which cut this is — 0 on a fresh item or a filled proposal. */
  attemptNumber: z.number().nullable().optional(),
});
export type GeneratedGraphic = z.infer<typeof generatedGraphicSchema>;

export const pendingRegenerateEditSchema = z.object({
  /** 0-based carousel slide, or null for the whole asset. */
  slideIndex: z.number().int().nullable(),
  /** `refine` re-renders that slide; `remove` drops it from the deck. */
  op: z.enum(['refine', 'remove']),
  /** Absent for a removal — there is nothing to instruct. */
  note: z.string().optional(),
  /** What to hold fixed at render time. See `regeneration-intent.ts`. */
  intent: z.enum(['copy', 'image', 'branding', 'full']).optional(),
});
export type PendingRegenerateEdit = z.infer<typeof pendingRegenerateEditSchema>;

/**
 * `GET /content-batches/items/:itemId/state` — the item, as an editor needs it.
 *
 * The one fact a card cannot know about itself: which cut is live, whether the
 * cut it was drawn for has been superseded, and — for a video — the words
 * currently on screen. "Change point 3" is answerable from `textFields` and
 * unanswerable without it, which is why a queued post used to get "can you tell
 * me what's on it now?" while the owner was looking straight at it.
 */
export const contentItemStateSchema = z.object({
  itemId: z.string(),
  kind: z.enum(['video', 'graphic']),
  /** The live cut. A card compares it to the one it was emitted against. */
  attemptId: z.string(),
  /** Null while the item is still only a PROPOSAL — shown, not yet acted on. */
  assetId: z.string().nullable(),
  superseded: z.boolean(),
  reviewStatus: z.string(),
  targetPageIds: z.array(z.string()),
  caption: z.string().nullable(),
  /** `{ items: ['…','…'], title: '…' }`. Empty for graphics. */
  textFields: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  /** The template block those fields live under, e.g. `numberedList`. */
  templateKey: z.string().nullable(),
  /**
   * A re-roll PROPOSED and not yet paid for. The card shows it and offers the
   * button; without it the proposal is staged, invisible, and reported as done.
   */
  pendingRegenerate: z.array(pendingRegenerateEditSchema).nullable(),
});
export type ContentItemState = z.infer<typeof contentItemStateSchema>;

/**
 * `GET /graphics` — list projection: `{ items, limit, offset }` (no total).
 *
 * Each item carries `itemId`, the content item that owns it, so the ONE id an
 * editor needs is the one a lister hands out. Null for graphics with no item —
 * onboarding ad candidates are not content items.
 */
export const listGraphicsResponseSchema = z.object({
  // OPTIONAL as well as nullable. The response contract is enforced on both
  // sides, so a required field is a field an older API cannot omit — which
  // turns a rolling deploy, or a lookup that returned nothing, into a failed
  // list rather than a list without lineage.
  items: z.array(
    graphicSchema.extend({ itemId: z.string().nullable().optional() })
  ),
  limit: z.number(),
  offset: z.number(),
});
export type ListGraphicsResponse = z.infer<typeof listGraphicsResponseSchema>;

// ============================================================================
// ASSETS
// ============================================================================

/** Minimal uploader (team member) snapshot joined onto assets. */
export const assetUploaderSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type AssetUploader = z.infer<typeof assetUploaderSchema>;

/** Minimal service ref badged onto an asset by the list endpoint. */
export const assetServiceRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AssetServiceRef = z.infer<typeof assetServiceRefSchema>;

/**
 * An asset row with its joined `uploader` and optional `services` badges. The
 * atom's dimension columns (`width`/`height`/`duration`) are already narrowed
 * numbers; only the joins are added here. `services` is optional — only the
 * list endpoint populates it.
 */
export const assetSchema = assetAtomSchema.extend({
  // The atom widens these typed text columns (`$type<...>()`) to bare strings;
  // narrow them back to the unions the api-client `Asset` type expects.
  placeholderTypes: z.array(z.enum(placeholderTypeValues)),
  probeStatus: z.enum(['pending', 'ready', 'failed']),
  transcodeStatus: z.enum(['pending', 'skipped', 'ready', 'failed']),
  uploader: assetUploaderSchema.nullable(),
  services: z.array(assetServiceRefSchema).optional(),
});
export type Asset = z.infer<typeof assetSchema>;

/**
 * `GET /assets/:id` — the DETAIL projection, which is NOT `assetSchema`.
 *
 * That distinction is load-bearing and was nearly got wrong: `assetSchema` is
 * the LIST shape (the full row plus joins), but `getAsset` runs an explicit
 * narrow `select({...})` and returns only the columns below. Deriving a caller
 * from `assetSchema` typechecks fine — every field it reads exists there — and
 * then fails at RUNTIME, because the parse demands `placeholderTypes`,
 * `probeStatus`, `transcodeStatus`, `source`, `codec` and a dozen more keys the
 * endpoint never sends.
 *
 * That is precisely the reader-vs-server drift `capability-architecture.md`
 * says only execution catches: the compiler is happy, the shape is plausible,
 * and the only symptom is a silently-empty result inside a `try/catch`.
 *
 * Anchored to the generated atom via `.pick()`, so a column rename breaks the
 * build rather than the request.
 */
export const getAssetResponseSchema = assetAtomSchema
  .pick({
    id: true,
    name: true,
    blobUrl: true,
    thumbnailUrl: true,
    sourceFileName: true,
    tags: true,
    clientName: true,
    type: true,
    duration: true,
    width: true,
    height: true,
    transcript: true,
    organizationId: true,
    uploadedById: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // LEFT JOIN on `user`: every field is null when the uploader row is gone.
    uploader: z
      .object({
        id: z.string().nullable(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        image: z.string().nullable(),
      })
      .nullable(),
  });

export type GetAssetResponse = z.infer<typeof getAssetResponseSchema>;

/**
 * An asset-library listing, as BOTH library routes actually return it.
 *
 * This used to be a union of `Asset[] | { items?: Asset[] }`, justified in a
 * comment claiming `GET /assets/by-service/:id` returns a BARE ARRAY because
 * `listAssetsByService` ends in `ok(rows.map(r => r.asset))`. That describes
 * the SERVICE, not the ROUTE: `assets.controller.ts:152` returns
 * `{ items: result.data }`. Both routes send an envelope, always, so the array
 * arm was unreachable and `items` was never absent — the union was the
 * defensive slop it insisted it wasn't, and its only consumer carried a dead
 * `Array.isArray(data)` branch to match.
 *
 * A union with an unreachable arm is worse than no union: it teaches every
 * reader that the API is inconsistent when it is not.
 *
 * Deliberately narrow: only the five fields a consumer actually reads are
 * required, each `.pick()`ed from the generated atom so a column rename fails
 * the build. Zod strips unknown keys, so the richer list projection still
 * parses — this asserts what is NEEDED rather than restating the whole row,
 * which is what makes it safe to point at two endpoints whose full shapes
 * differ.
 */
export const assetLibraryItemSchema = assetAtomSchema.pick({
  id: true,
  name: true,
  type: true,
  thumbnailUrl: true,
  blobUrl: true,
});

export const assetLibraryListingSchema = z.object({
  items: z.array(assetLibraryItemSchema),
});

export type AssetLibraryItem = z.infer<typeof assetLibraryItemSchema>;
export type AssetLibraryListing = z.infer<typeof assetLibraryListingSchema>;

/** `GET /assets` — list projection: `{ items, total, limit, offset }`. */
export const listAssetsResponseSchema = z.object({
  items: z.array(assetSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListAssetsResponse = z.infer<typeof listAssetsResponseSchema>;

/**
 * `GET /assets/by-service/:serviceId` — `{ items }`.
 *
 * `assetSchema` is the WRONG element type here and always was, which is why
 * this schema could not parse its own endpoint on any non-empty response.
 * `assetSchema` requires `uploader` (`.nullable()`, but not `.optional()`, so
 * an ABSENT key fails), and `listAssetsByService` does
 * `select({ asset, confidence }).innerJoin(...)` then `rows.map(r => r.asset)`
 * — a full asset row with no `user` join anywhere in the query. `services` is
 * spared only because it happens to be `.optional()`.
 *
 * Omitting `uploader` rather than making it optional on `assetSchema`: the
 * paged `GET /assets` route DOES join the uploader and its absence there would
 * be a real defect, so loosening the shared schema would blind that route to
 * keep this one quiet.
 */
export const assetByServiceSchema = assetSchema.omit({ uploader: true });
export type AssetByService = z.infer<typeof assetByServiceSchema>;

export const listAssetsByServiceResponseSchema = z.object({
  items: z.array(assetByServiceSchema),
});
export type ListAssetsByServiceResponse = z.infer<
  typeof listAssetsByServiceResponseSchema
>;

// ---------------------------------------------------------------------------
// Asset analysis (AI tagging)
// ---------------------------------------------------------------------------

/** One AI-matched service suggestion inside an analysis result. */
export const assetMatchedServiceSchema = z.object({
  serviceName: z.string(),
  serviceId: z.string().optional(),
  confidence: z.number(),
});

/** One classified action segment inside an analysis result. */
export const assetActionSegmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  label: z.enum(['action', 'transition', 'idle']),
  description: z.string().optional(),
});

/** Quality flags surfaced by the analyzer. */
export const assetQualityFlagsSchema = z.object({
  isShaky: z.boolean().optional(),
  isBlurry: z.boolean().optional(),
  isPoorLighting: z.boolean().optional(),
  showsOnlyEquipment: z.boolean().optional(),
  isTooShort: z.boolean().optional(),
});

/** The AI analysis payload (jsonb `$type<AssetAnalysisResult>`). */
export const assetAnalysisResultSchema = z.object({
  description: z.string(),
  contentType: z.enum(assetContentTypeValues),
  matchedServices: z.array(assetMatchedServiceSchema),
  suggestedTags: z.array(z.string()),
  frameCount: z.number(),
  modelUsed: z.string(),
  processingTimeMs: z.number(),
  actionSegments: z.array(assetActionSegmentSchema).optional(),
  videoDurationSec: z.number().optional(),
  qualityScore: z.number().optional(),
  qualityFlags: assetQualityFlagsSchema.optional(),
});
export type AssetAnalysisResult = z.infer<typeof assetAnalysisResultSchema>;

/** An asset-analysis row with its `analysisResult` jsonb hand-narrowed. */
export const assetAnalysisSchema = assetAnalysisAtomSchema.extend({
  analysisResult: assetAnalysisResultSchema.nullable(),
});
export type AssetAnalysis = z.infer<typeof assetAnalysisSchema>;

/** A service linked to an asset via the asset_service junction (computed). */
export const assetLinkedServiceSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  serviceName: z.string(),
  serviceCategory: z.string(),
  confidence: z.number().nullable(),
  isAutoGenerated: z.boolean(),
});
export type AssetLinkedService = z.infer<typeof assetLinkedServiceSchema>;

/** `POST /assets/:id/services` — the asset's linked services after linking. */
export const assetLinkedServicesResponseSchema = z.array(
  assetLinkedServiceSchema
);
export type AssetLinkedServicesResponse = z.infer<
  typeof assetLinkedServicesResponseSchema
>;

/** `GET /assets/:id/analysis` — analysis + its linked services. */
export const getAssetAnalysisResponseSchema = z.object({
  analysis: assetAnalysisSchema.nullable(),
  linkedServices: z.array(assetLinkedServiceSchema),
});
export type GetAssetAnalysisResponse = z.infer<
  typeof getAssetAnalysisResponseSchema
>;

/**
 * `GET /videos/stock-clips` — the curated stock bank, as candidates to pick.
 *
 * Browse only: listing mints nothing. Org-owned `asset` rows are created on
 * ATTACH via `POST /videos/stock-clips/mint`, so offering ten options does not
 * litter the library with nine unused assets.
 */
export const stockClipPreviewSchema = z.object({
  stockClipId: z.string(),
  mediaType: z.enum(['video', 'image']),
  description: z.string().nullable(),
  /** True when the clip is from the generic pool rather than service-matched. */
  isGeneric: z.boolean(),
  durationSec: z.number().nullable(),
  previewUrl: z.string(),
});
export type StockClipPreview = z.infer<typeof stockClipPreviewSchema>;

export const listStockClipsResponseSchema = z.object({
  items: z.array(stockClipPreviewSchema),
});
export type ListStockClipsResponse = z.infer<
  typeof listStockClipsResponseSchema
>;

/**
 * `POST /videos/stock-clips/mint` — copy-on-attach.
 *
 * Returns `stockClipId -> assetId` for org-owned rows that behave exactly like
 * uploaded footage from here on, so the ids drop straight into `clipOperations`
 * or `bRollClips`.
 */
export const mintStockClipsResponseSchema = z.object({
  assetIds: z.record(z.string(), z.string()),
});
export type MintStockClipsResponse = z.infer<
  typeof mintStockClipsResponseSchema
>;

// ============================================================================
// CONTENT BATCHES
// ============================================================================

/** A content batch header row — the atom, verbatim. */
export const contentBatchSchema = contentBatchAtomSchema;
export type ContentBatch = z.infer<typeof contentBatchSchema>;

/** Per-slot narrative blob (jsonb `$type<VideoIdea>`) on a batch item. */
export const contentBatchVideoIdeaSchema = z.object({
  topic: z.string(),
  angle: z.string(),
  payoff: z.string(),
  audience: z.string(),
  serviceName: z.string(),
});
export type ContentBatchVideoIdea = z.infer<typeof contentBatchVideoIdeaSchema>;

/**
 * A batch item row, with its jsonb columns hand-narrowed: `targetPageIds`
 * (string ids) and `videoIdea` (the narrative blob).
 */

/**
 * `POST /content-batches/items/:itemId/messages` — one turn of an edit.
 *
 * The owner says what they want changed; the server decides WHICH lever that is
 * (the caption, the on-screen text, the clips, or a re-roll) using state the
 * caller does not hold — the item's kind, its active template block and current
 * field values, its clip list. Exactly one lever per turn, because the caption
 * is free and the pixels are a render, and a turn that quietly did both would
 * make the history unreadable.
 *
 * Video edits are STAGED, never applied here. Committing them is a separate
 * call, so several instructions cost one render.
 */
export const stagedClipEditSchema = z.union([
  z.object({
    op: z.literal('swap'),
    /** 1-based, matching what the owner said and what the tray shows. */
    clipNumber: z.number().int(),
    assetId: z.string().optional(),
  }),
  z.object({ op: z.literal('remove'), clipNumber: z.number().int() }),
  /** The whole list, rearranged by hand — it addresses no single position. */
  z.object({ op: z.literal('relist'), clipCount: z.number().int() }),
]);
export type StagedClipEdit = z.infer<typeof stagedClipEditSchema>;

export const reviewTurnResponseSchema = z.object({
  caption: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      captionSnapshot: z.string().nullable(),
      createdAt: z.string(),
    })
  ),
  suggestedRule: z
    .object({ title: z.string(), content: z.string() })
    .nullable(),
  /** Null when the turn changed nothing about the video. */
  stagedEdits: z
    .object({
      clips: z.array(stagedClipEditSchema),
      textChanges: z.array(z.string()),
    })
    .nullable(),
  /** Re-renders this item's edits have already cost. Visible, not capped. */
  renderCount: z.number().int(),
  /** A re-roll PROPOSED and not yet confirmed — it costs a render. */
  pendingRegenerate: z.array(pendingRegenerateEditSchema).nullable(),
});
export type ReviewTurnResponse = z.infer<typeof reviewTurnResponseSchema>;

export const contentItemSchema = contentItemAtomSchema.extend({
  targetPageIds: z.array(z.string()).nullable(),
  videoIdea: contentBatchVideoIdeaSchema.nullable(),
  /**
   * Narrowed here, not on the column: the generator emits `z.unknown()` for
   * every jsonb, so typing `pending_regenerate` in the schema would put the row
   * type and its atom permanently out of step.
   */
  pendingRegenerate: z.array(pendingRegenerateEditSchema).nullable(),
});
export type ContentItem = z.infer<typeof contentItemSchema>;

/**
 * A post as the review UI receives it: the SLOT, flattened with the CUT
 * currently in it. Either `video` or `graphic` is set depending on `kind`; the
 * UI keys off `kind` for which card to render.
 *
 * The attempt's fields are lifted onto the item rather than nested, so the
 * wire shape callers already read (`item.caption`, `item.video`) survives the
 * slot/attempt split unchanged. What no longer exists is `previousItemId`:
 * there is one row per post and the server has already resolved which cut is
 * live, so there is no chain for a client to walk — or to forget to walk.
 */
export const contentItemWithAssetSchema = contentItemSchema.extend({
  video: videoSchema.nullable(),
  graphic: graphicSchema.nullable(),
  attemptId: z.string(),
  attemptNumber: z.number().int(),
  caption: z.string().nullable(),
  pendingVideoEdits: z.unknown(),
  editRenderCount: z.number().int(),
  regenerationReason: z.string().nullable(),
  /** An earlier cut exists to go back to. Not the same as "under the cap". */
  canUndoRegenerate: z.boolean(),
});
export type ContentItemWithAsset = z.infer<typeof contentItemWithAssetSchema>;

/**
 * `POST /content-batches/items/:itemId/regenerate` — the re-roll outcome.
 *
 * NOT a `contentItemSchema`, which is what the client used to parse this
 * as: the response is a summary of what the re-roll did, with the slot row
 * under `item`. Parsing it as a bare item failed validation on every call —
 * silently, because response parsing defaults to report-mode — and handed the
 * caller a mistyped object.
 *
 * `id` is the SLOT and equals the `itemId` in the path: a re-roll appends a cut
 * to the post that was already there rather than minting a replacement, so
 * there is nothing for the client to follow.
 */
export const regenerateBatchItemResponseSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  position: z.number().int(),
  regenerationCount: z.number().int(),
  /** The newly appended cut, and its place in the slot's history. */
  attemptId: z.string(),
  attemptNumber: z.number().int(),
  /** Whichever of these the slot's kind implies — the new row to poll. */
  graphicId: z.string().optional(),
  videoId: z.string().optional(),
  item: contentItemSchema,
});
export type RegenerateBatchItemResponse = z.infer<
  typeof regenerateBatchItemResponseSchema
>;

/**
 * `POST /content-batches/items/:itemId/undo-regenerate` — back one cut.
 *
 * Carries the restored cut's asset and caption so the client can swap the card
 * without waiting for a refetch: nothing is re-rendered, so the previous
 * version is already there to show.
 */
export const undoRegenerateResponseSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  position: z.number().int(),
  /** Unchanged by an undo — going back does not refund a regeneration. */
  regenerationCount: z.number().int(),
  attemptId: z.string(),
  attemptNumber: z.number().int(),
  videoId: z.string().nullable(),
  graphicId: z.string().nullable(),
  caption: z.string().nullable(),
  /** Whether there is a further cut back — i.e. can this be pressed again. */
  canUndoRegenerate: z.boolean(),
  item: contentItemSchema,
});
export type UndoRegenerateResponse = z.infer<
  typeof undoRegenerateResponseSchema
>;

/** `GET /content-batches/:id` (and `/current`) — batch + hydrated items. */
export const getContentBatchResponseSchema = z.object({
  batch: contentBatchSchema,
  items: z.array(contentItemWithAssetSchema),
});
export type GetContentBatchResponse = z.infer<
  typeof getContentBatchResponseSchema
>;

/** `GET /content-batches` — list projection: `{ items, limit, offset }`. */
export const listContentBatchesResponseSchema = z.object({
  items: z.array(contentBatchSchema),
  limit: z.number(),
  offset: z.number(),
});
export type ListContentBatchesResponse = z.infer<
  typeof listContentBatchesResponseSchema
>;

/** `POST /content-batches/generate` — async trigger result (no table). */
export const generateContentBatchResponseSchema = z.object({
  batch: contentBatchSchema,
  alreadyExisted: z.boolean(),
  queued: z.boolean(),
  // Async seeding (requestMonthlyBatch): the effective per-batch counts the
  // preflight settled on, and the BullMQ job id when generation was queued.
  effectiveGraphicCount: z.number(),
  effectiveVideoCount: z.number(),
  jobId: z.string().optional(),
});
export type GenerateContentBatchResponse = z.infer<
  typeof generateContentBatchResponseSchema
>;

/** `DELETE /content-batches/current` — reset outcome (no table). */
export const deleteCurrentBatchResponseSchema = z.object({
  deleted: z.boolean(),
  batchId: z.string().optional(),
});
export type DeleteCurrentBatchResponse = z.infer<
  typeof deleteCurrentBatchResponseSchema
>;

// ============================================================================
// AI CONTENT — LLM copy generation (no backing table, fully computed)
// ============================================================================

/** Paid-ad copy bundle. */
export const aiAdContentSchema = z.object({
  headline: z.string(),
  primaryText: z.string(),
  description: z.string(),
  callToAction: z.string(),
});
export type AiAdContent = z.infer<typeof aiAdContentSchema>;

/** Organic social-post copy bundle. */
export const aiSocialPostContentSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
});
export type AiSocialPostContent = z.infer<typeof aiSocialPostContentSchema>;

/** `POST /ai-content/generate` — a discriminated ad / social-post result. */
export const generatedContentSchema = z.discriminatedUnion('contentType', [
  z.object({ contentType: z.literal('ad'), content: aiAdContentSchema }),
  z.object({
    contentType: z.literal('social-post'),
    content: aiSocialPostContentSchema,
  }),
]);
export type GeneratedContent = z.infer<typeof generatedContentSchema>;

/** `POST /ai-content/generate-offer-content` — headline + bullet points. */
export const generatedOfferContentSchema = z.object({
  headline: z.string(),
  bulletPoints: z.array(z.string()),
});
export type GeneratedOfferContent = z.infer<typeof generatedOfferContentSchema>;

/** `POST /ai-content/generate-offer-copy` — the full video-copy bundle. */
export const generatedOfferCopySchema = z.object({
  headline: z.string(),
  ctaText: z.string(),
  urgencyText: z.string(),
  audienceText: z.string(),
  bulletPoints: z.array(z.string()),
});
export type GeneratedOfferCopy = z.infer<typeof generatedOfferCopySchema>;
