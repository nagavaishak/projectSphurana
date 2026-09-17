/**
 * Content-domain contract proofs — the response PROJECTIONS in
 * `packages/contracts/src/responses/content.ts` are the same schemas the
 * runtime parses responses with AND the schemas that validate these fixtures.
 *
 * Two kinds of proof here:
 *  1. `fixture(schema, …)` for every domain's primary projection — strict
 *     construction (throws on any missing/mismatched atom field), so a mock
 *     can't drift from the contract.
 *  2. A wired-hook render (`useListSocialPosts` → `apiClient.get(path, { schema })`)
 *     proving a schema-validated fixture flows end-to-end into a component.
 */
import { renderWithProviders, screen } from '@/test/render';
import {
  type Asset,
  type ContentBatch,
  type ContentItem,
  type ContentItemWithAsset,
  type Graphic,
  type SocialPost,
  type VideoWithCreator,
  assetSchema,
  contentBatchSchema,
  contentItemSchema,
  contentItemWithAssetSchema,
  fixture,
  getContentBatchResponseSchema,
  graphicSchema,
  listAssetsResponseSchema,
  listGraphicsResponseSchema,
  listSocialPostsResponseSchema,
  listVideosResponseSchema,
  socialPostSchema,
  videoWithCreatorSchema,
} from '@borradh-workspace/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// useListSocialPosts → apiClient.get('social-posts?…'). Mock api-client so
// React Query resolves our schema-validated fixture exactly as production does.
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));

import { useListSocialPosts } from '@/features/social-posts/api/list-social-posts/list-social-posts.hook';

// ---------------------------------------------------------------------------
// Base fixtures — one valid on-wire row per projection (dates as ISO strings).
// ---------------------------------------------------------------------------

const aSocialPost = (overrides?: Partial<SocialPost>): SocialPost =>
  fixture(socialPostSchema, {
    id: 'post_1',
    organizationId: 'org_1',
    title: 'Summer promo',
    caption: 'Book now',
    mediaType: 'image',
    mediaUrl: 'https://cdn.example.com/a.jpg',
    mediaUrls: null,
    thumbnailUrl: null,
    videoId: null,
    graphicId: null,
    platforms: ['facebook', 'instagram'],
    platformSettings: null,
    scheduledAt: null,
    publishedAt: null,
    status: 'draft',
    platformResults: null,
    errorMessage: null,
    createdById: 'user_1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

const aVideo = (overrides?: Partial<VideoWithCreator>): VideoWithCreator =>
  fixture(videoWithCreatorSchema, {
    id: 'video_1',
    title: 'Before & after',
    status: 'ready',
    errorMessage: null,
    progress: 100,
    usageType: 'organic',
    processingStage: null,
    stageStartedAt: null,
    draftConfig: null,
    schemaVersion: 1,
    renderDoc: null,
    synthesisOverrides: null,
    synthesisSeed: null,
    blobUrl: 'https://cdn.example.com/v.mp4',
    thumbnailUrl: null,
    durationMs: 15000,
    templateId: null,
    variationId: null,
    serviceId: null,
    offerId: null,
    organizationId: 'org_1',
    createdById: 'user_1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    exportedAt: null,
    creator: {
      id: 'user_1',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
    },
    ...overrides,
  });

const aGraphic = (overrides?: Partial<Graphic>): Graphic =>
  fixture(graphicSchema, {
    id: 'graphic_1',
    title: 'Tip of the week',
    status: 'ready',
    usageType: 'organic',
    serviceId: null,
    topicSummary: null,
    kind: 'single',
    templateSlug: null,
    // Copy actually rendered onto the graphic, persisted so a regenerate can
    // amend it rather than write a new deck. Nullable for graphics rendered
    // before the column existed — but the atom still requires the key.
    renderedCopy: null,
    aspectRatio: '1:1',
    canvasWidth: 1080,
    canvasHeight: 1080,
    outputs: null,
    // main's 0059 (regenerated here as 0091) — nullable, but the contract atom
    // requires the keys to be present.
    errorCode: null,
    errorMessage: null,
    // 0093 provenance columns — same deal: nullable, keys required.
    offerId: null,
    sourceAssetIds: null,
    allowAiImages: null,
    organizationId: 'org_1',
    createdById: 'user_1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

const anAsset = (overrides?: Partial<Asset>): Asset =>
  fixture(assetSchema, {
    id: 'asset_1',
    name: 'clip.mp4',
    blobUrl: 'https://cdn.example.com/asset.mp4',
    thumbnailUrl: null,
    sourceFileName: 'clip.mp4',
    tags: ['procedure'],
    clientName: null,
    type: 'video',
    source: 'raw',
    placeholderTypes: ['procedure_generic'],
    duration: 12,
    width: 1920,
    height: 1080,
    codec: 'h264',
    pixFmt: 'yuv420p',
    bitrateKbps: 4200,
    probeStatus: 'ready',
    probedAt: '2024-01-01T00:00:00.000Z',
    transcodeStatus: 'skipped',
    transcodedBlobUrl: null,
    transcodedAt: null,
    transcript: null,
    capturedAt: null,
    batchId: null,
    stockClipId: null,
    organizationId: 'org_1',
    uploadedById: 'user_1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    uploader: {
      id: 'user_1',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
    },
    ...overrides,
  });

const aBatch = (overrides?: Partial<ContentBatch>): ContentBatch =>
  fixture(contentBatchSchema, {
    id: 'batch_1',
    organizationId: 'org_1',
    periodMonth: '2024-05',
    status: 'review',
    errorMessage: null,
    finaliseAt: null,
    reviewedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

/**
 * The SLOT. Since the slot/attempt split this row carries no asset, no caption
 * and no staged edits — those belong to the cut currently in it, and arrive
 * flattened on top via `aBatchItemWithAsset` below. `previousItemId` is gone
 * entirely: one row per post, no chain.
 */
const aBatchItem = (overrides?: Partial<ContentItem>): ContentItem =>
  fixture(contentItemSchema, {
    id: 'item_1',
    organizationId: 'org_1',
    batchId: 'batch_1',
    source: 'monthly_batch',
    kind: 'graphic',
    currentAttemptId: 'attempt_1',
    reviewStatus: 'pending',
    position: 0,
    regenerationCount: 0,
    scheduledSocialPostId: null,
    scheduledAt: null,
    targetPageIds: null,
    videoIdea: null,
    pendingRegenerate: null,
    decidedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

/** The slot as the review UI receives it: flattened with its current cut. */
const aBatchItemWithAsset = (
  overrides?: Partial<ContentItemWithAsset>
): ContentItemWithAsset =>
  fixture(contentItemWithAssetSchema, {
    ...aBatchItem(),
    video: null,
    graphic: aGraphic(),
    attemptId: 'attempt_1',
    attemptNumber: 0,
    caption: null,
    pendingVideoEdits: null,
    editRenderCount: 0,
    regenerationReason: null,
    canUndoRegenerate: false,
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Fixture-construction proofs (strict — throw on any atom-field mismatch).
// ---------------------------------------------------------------------------

describe('content projections construct as strict fixtures', () => {
  it('builds one valid row per domain', () => {
    expect(aSocialPost().platforms).toEqual(['facebook', 'instagram']);
    expect(aVideo().creator?.name).toBe('Ada');
    expect(aGraphic().kind).toBe('single');
    expect(anAsset().probeStatus).toBe('ready');
    expect(aBatch().periodMonth).toBe('2024-05');
    expect(aBatchItem().kind).toBe('graphic');
  });

  it('narrows the jsonb columns the generator widened', () => {
    // Carousel media, typed platform results, graphic outputs, batch idea.
    const post = aSocialPost({
      mediaUrls: ['https://a', 'https://b'],
      platformResults: [{ platform: 'facebook', success: true, postId: 'fb1' }],
    });
    expect(post.mediaUrls).toHaveLength(2);
    expect(post.platformResults?.[0].platform).toBe('facebook');

    const graphic = aGraphic({
      kind: 'carousel',
      outputs: [
        {
          aspectRatioId: '1:1',
          platform: 'instagram',
          width: 1080,
          height: 1080,
          url: 'https://cdn/out.png',
          format: 'png',
          renderedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(graphic.outputs?.[0].format).toBe('png');
  });

  it('builds nested list + batch wrappers', () => {
    const batchResponse = fixture(getContentBatchResponseSchema, {
      batch: aBatch(),
      items: [aBatchItemWithAsset()],
    });
    expect(batchResponse.items[0].graphic?.id).toBe('graphic_1');
    // The cut's fields ride on the item, so consumers keep reading
    // `item.caption` / `item.video` across the slot/attempt split.
    expect(batchResponse.items[0].attemptNumber).toBe(0);
    expect(batchResponse.items[0].canUndoRegenerate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// List-wrapper contracts — limit/offset are part of the contract.
// ---------------------------------------------------------------------------

describe('content list wrappers require their pagination fields', () => {
  it('videos/social/assets require total + limit + offset', () => {
    expect(
      listVideosResponseSchema.safeParse({ items: [], limit: 20, offset: 0 })
        .success
    ).toBe(false);
    expect(
      listSocialPostsResponseSchema.safeParse({
        items: [],
        total: 0,
        limit: 20,
      }).success
    ).toBe(false);
    expect(
      listAssetsResponseSchema.safeParse({ items: [aSocialPost()] }).success
    ).toBe(false);
  });

  it('graphics list requires limit + offset (no total)', () => {
    expect(
      listGraphicsResponseSchema.safeParse({ items: [aGraphic()] }).success
    ).toBe(false);
    expect(
      listGraphicsResponseSchema.safeParse({
        // `itemId` is required and nullable, not optional: the list is where a
        // caller gets the id an EDIT takes, and a graphic with no post behind it
        // has to say so rather than leave the field off and read as "unknown".
        items: [{ ...aGraphic(), itemId: null }],
        limit: 20,
        offset: 0,
      }).success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wired-hook proof — the list projection flows through the real hook.
// ---------------------------------------------------------------------------

function SocialPostListHarness() {
  const { posts, total } = useListSocialPosts();
  return (
    <div>
      <p>total: {total}</p>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
    </div>
  );
}

describe('listSocialPosts projection contract', () => {
  beforeEach(() => get.mockReset());

  it('renders posts from a schema-validated list response', async () => {
    const response = fixture(listSocialPostsResponseSchema, {
      items: [
        aSocialPost({ id: 'p1', title: 'Summer promo' }),
        aSocialPost({ id: 'p2', title: 'Autumn promo' }),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    get.mockResolvedValue(response);

    renderWithProviders(<SocialPostListHarness />);

    expect(await screen.findByText('Summer promo')).toBeTruthy();
    expect(await screen.findByText('Autumn promo')).toBeTruthy();
    // The hook passed the list schema to apiClient.get.
    expect(get).toHaveBeenCalledWith(
      'social-posts',
      expect.objectContaining({ schema: listSocialPostsResponseSchema })
    );
  });
});
