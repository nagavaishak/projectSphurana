import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not their barrels: barrel re-exports are live getters
// under Vite SSR and cannot be redefined, and a file-local `vi.mock` would
// persist on the shared worker module graph under `isolate: false` (a bare
// factory also deletes every export it omits).
import * as getGraphicModule from '../../../graphics/services/get-graphic/get-graphic.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as createSocialPostModule from '../../../social-posts/services/create-social-post/create-social-post.service.js';
import * as getVideoModule from '../../../videos/services/get-video/get-video.service.js';
import {
  attemptFixture,
  joinedRow,
  settleNoopQuery,
  slotFixture,
} from '../_shared/test-fixtures.js';

import { acceptBatchItem } from './accept-batch-item.service.js';

let createSocialPostMock: MockInstance;
let getVideoMock: MockInstance;
let getGraphicMock: MockInstance;

// The service runs:
// 1. db.select().from().innerJoin().where().limit() → joined row(s)
// 2. (if video) getVideo(...) / (if graphic) getGraphic(...) → media
// 3. createSocialPost(...) → scheduled post
// 4. db.update().set().where().returning() → updated row(s)
const createSelectChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'innerJoin', 'where'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

const createUpdateChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['set', 'where'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.returning = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

let selectChain: ReturnType<typeof createSelectChain>;
let updateChain: ReturnType<typeof createUpdateChain>;

const mockDb = {
  select: vi.fn().mockImplementation(() => selectChain),
  update: vi.fn().mockImplementation(() => updateChain),
  // Accept writes the slot's decision and the attempt's caption together, so
  // the mock has to be able to open a transaction. The callback receives the
  // same mock, which is what lets both writes land on `updateChain`.
  transaction: vi.fn(async (cb: (trx: unknown) => unknown) => cb(mockDb)),
  // Accepting settles the batch's status, which reads the batch back.
  query: settleNoopQuery(),
};

// The slot half: the decision and the schedule.
const pendingVideoRow = slotFixture({
  kind: 'video',
  scheduledAt: new Date('2026-06-15T10:00:00Z'),
  targetPageIds: ['page_1', 'page_2'],
});

// The cut half: the asset and the words.
const videoAttempt = attemptFixture({
  videoId: 'video_123',
  caption: 'Planner-generated caption',
});

const graphicAttempt = attemptFixture({
  videoId: null,
  graphicId: 'graphic_123',
  caption: 'Planner-generated caption',
});

const readyVideo = {
  id: 'video_123',
  title: 'Test Video Title',
  status: 'ready' as const,
  blobUrl: 'https://cdn.example.com/video_123.mp4',
  thumbnailUrl: 'https://cdn.example.com/video_123.jpg',
  createdById: 'user_999',
  organizationId: 'org_123',
};

const baseInput = {
  itemId: 'item_123',
  organizationId: 'org_123',
  createdById: 'user_abc',
};

describe('acceptBatchItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSocialPostMock = vi.spyOn(
      createSocialPostModule,
      'createSocialPost'
    ) as unknown as MockInstance;
    getVideoMock = vi.spyOn(
      getVideoModule,
      'getVideo'
    ) as unknown as MockInstance;
    getGraphicMock = vi.spyOn(
      getGraphicModule,
      'getGraphic'
    ) as unknown as MockInstance;
    // Default to a bare stub so nothing can fall through to the real service.
    createSocialPostMock.mockReturnValue(undefined);
    getVideoMock.mockReturnValue(undefined);
    getGraphicMock.mockReturnValue(undefined);
    selectChain = createSelectChain([]);
    updateChain = createUpdateChain([]);
  });

  afterEach(() => {
    createSocialPostMock.mockRestore();
    getVideoMock.mockRestore();
    getGraphicMock.mockRestore();
  });

  it('schedules the social post using overrides when provided', async () => {
    selectChain = createSelectChain([
      joinedRow({ slot: pendingVideoRow, attempt: videoAttempt }),
    ]);
    getVideoMock.mockResolvedValueOnce({ success: true, data: readyVideo });
    createSocialPostMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'post_555' },
    });
    const acceptedRow = {
      ...pendingVideoRow,
      reviewStatus: 'accepted' as const,
      decidedAt: new Date(),
      scheduledSocialPostId: 'post_555',
    };
    updateChain = createUpdateChain([acceptedRow]);

    const overrideDate = new Date('2026-07-01T15:00:00Z');
    const data = await expectResult(
      acceptBatchItem(mockDb as never, {
        ...baseInput,
        caption: 'User-edited caption',
        scheduledAt: overrideDate,
        targetPageIds: ['page_3'],
      })
    ).toSucceedWith((d) => {
      expect(d.reviewStatus).toBe('accepted');
      expect(d.scheduledSocialPostId).toBe('post_555');
    });

    expect(data.id).toBe('item_123');
    expect(createSocialPostMock).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: 'org_123',
        createdById: 'user_abc',
        title: 'Test Video Title',
        caption: 'User-edited caption',
        mediaType: 'video',
        mediaUrl: 'https://cdn.example.com/video_123.mp4',
        thumbnailUrl: 'https://cdn.example.com/video_123.jpg',
        videoId: 'video_123',
        pageIds: ['page_3'],
        scheduledAt: overrideDate,
        status: 'scheduled',
      })
    );
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewStatus: 'accepted',
        scheduledSocialPostId: 'post_555',
      })
    );
  });

  it('falls back to item.caption / scheduledAt / targetPageIds when overrides are absent', async () => {
    selectChain = createSelectChain([
      joinedRow({ slot: pendingVideoRow, attempt: videoAttempt }),
    ]);
    getVideoMock.mockResolvedValueOnce({ success: true, data: readyVideo });
    createSocialPostMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'post_777' },
    });
    updateChain = createUpdateChain([
      {
        ...pendingVideoRow,
        reviewStatus: 'accepted' as const,
        decidedAt: new Date(),
        scheduledSocialPostId: 'post_777',
      },
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toSucceedWith();

    expect(createSocialPostMock).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        caption: 'Planner-generated caption',
        scheduledAt: pendingVideoRow.scheduledAt,
        pageIds: ['page_1', 'page_2'],
        status: 'scheduled',
      })
    );
  });

  it('schedules a graphic item using its first rendered slide', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, kind: 'graphic' },
        attempt: graphicAttempt,
      }),
    ]);
    getGraphicMock.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'graphic_123',
        title: 'Graphic Title',
        status: 'ready',
        outputs: [
          { url: 'https://cdn.example.com/slide_1.jpg', aspectRatioId: '4:5' },
          { url: 'https://cdn.example.com/slide_2.jpg', aspectRatioId: '4:5' },
        ],
      },
    });
    createSocialPostMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'post_g1' },
    });
    updateChain = createUpdateChain([
      {
        ...graphicAttempt,
        reviewStatus: 'accepted' as const,
        decidedAt: new Date(),
        scheduledSocialPostId: 'post_g1',
      },
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toSucceedWith();

    // Graphics don't touch getVideo, and only the first slide is posted.
    expect(getVideoMock).not.toHaveBeenCalled();
    expect(createSocialPostMock).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        title: 'Graphic Title',
        mediaType: 'image',
        mediaUrl: 'https://cdn.example.com/slide_1.jpg',
        graphicId: 'graphic_123',
        pageIds: ['page_1', 'page_2'],
        status: 'scheduled',
      })
    );
  });

  it('schedules a carousel graphic with ALL slides in order', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, kind: 'graphic' },
        attempt: graphicAttempt,
      }),
    ]);
    // Real carousels tag each output with slideId + slideOrder (one per slide).
    // Provide them out of order to prove we sort by slideOrder.
    getGraphicMock.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'graphic_123',
        title: 'Carousel Title',
        kind: 'carousel',
        status: 'ready',
        outputs: [
          {
            url: 'https://cdn.example.com/slide_2.jpg',
            slideId: 's2',
            slideOrder: 2,
            aspectRatioId: '4:5',
          },
          {
            url: 'https://cdn.example.com/slide_0.jpg',
            slideId: 's0',
            slideOrder: 0,
            aspectRatioId: '4:5',
          },
          {
            url: 'https://cdn.example.com/slide_1.jpg',
            slideId: 's1',
            slideOrder: 1,
            aspectRatioId: '4:5',
          },
        ],
      },
    });
    createSocialPostMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'post_c1' },
    });
    updateChain = createUpdateChain([
      {
        ...graphicAttempt,
        reviewStatus: 'accepted' as const,
        decidedAt: new Date(),
        scheduledSocialPostId: 'post_c1',
      },
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toSucceedWith();

    expect(createSocialPostMock).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        mediaType: 'image',
        mediaUrl: 'https://cdn.example.com/slide_0.jpg',
        mediaUrls: [
          'https://cdn.example.com/slide_0.jpg',
          'https://cdn.example.com/slide_1.jpg',
          'https://cdn.example.com/slide_2.jpg',
        ],
        graphicId: 'graphic_123',
      })
    );
  });

  it('does not flip reviewStatus when createSocialPost fails', async () => {
    selectChain = createSelectChain([
      joinedRow({ slot: pendingVideoRow, attempt: videoAttempt }),
    ]);
    getVideoMock.mockResolvedValueOnce({ success: true, data: readyVideo });
    createSocialPostMock.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'meta is down' },
    });

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the video is not ready', async () => {
    selectChain = createSelectChain([
      joinedRow({ slot: pendingVideoRow, attempt: videoAttempt }),
    ]);
    getVideoMock.mockResolvedValueOnce({
      success: true,
      data: { ...readyVideo, status: 'processing' },
    });

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);

    expect(createSocialPostMock).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the item has no target pages', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, targetPageIds: null },
        attempt: videoAttempt,
      }),
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);

    expect(getVideoMock).not.toHaveBeenCalled();
    expect(createSocialPostMock).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when itemId is empty', async () => {
    await expectResult(
      acceptBatchItem(mockDb as never, { ...baseInput, itemId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when createdById is empty', async () => {
    await expectResult(
      acceptBatchItem(mockDb as never, { ...baseInput, createdById: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the item does not exist', async () => {
    selectChain = createSelectChain([]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(getVideoMock).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the item belongs to another organization', async () => {
    selectChain = createSelectChain([]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(getVideoMock).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the item was already accepted', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, reviewStatus: 'accepted' as const },
        attempt: videoAttempt,
      }),
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);

    expect(getVideoMock).not.toHaveBeenCalled();
  });

  // The page requirement belongs to SCHEDULING. A post made in conversation has
  // no seeded pages at all, so demanding one refused every Save outright.
  it('saves without any target pages', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, scheduledAt: null, targetPageIds: [] },
        attempt: videoAttempt,
      }),
    ]);
    getVideoMock.mockResolvedValueOnce({ success: true, data: readyVideo });
    updateChain = createUpdateChain([
      {
        ...pendingVideoRow,
        reviewStatus: 'accepted' as const,
        decidedAt: new Date(),
        scheduledSocialPostId: null,
      },
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toSucceedWith();
    expect(createSocialPostMock).not.toHaveBeenCalled();
  });

  it('settles the batch after the decision — the last accept completes it', async () => {
    // Without this the settle call could be deleted and nothing would fail:
    // the batch would be stuck on 'generating' again, which is the whole bug
    // (ENG-788). Hand it a batch whose queue this accept empties.
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce({
      id: 'batch_123',
      status: 'review',
      items: [
        {
          id: 'item_123',
          kind: 'video',
          reviewStatus: 'accepted',
          currentAttempt: {
            id: 'attempt_123',
            video: { status: 'ready' },
            graphic: null,
          },
        },
      ],
    });
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, scheduledAt: null, targetPageIds: [] },
        attempt: videoAttempt,
      }),
    ]);
    getVideoMock.mockResolvedValueOnce({ success: true, data: readyVideo });
    updateChain = createUpdateChain([
      {
        ...pendingVideoRow,
        reviewStatus: 'accepted' as const,
        decidedAt: new Date(),
        scheduledSocialPostId: null,
      },
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toSucceedWith();

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('creates NO social post when the owner saves rather than schedules', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingVideoRow, scheduledAt: null },
        attempt: videoAttempt,
      }),
    ]);
    getVideoMock.mockResolvedValueOnce({ success: true, data: readyVideo });
    createSocialPostMock.mockResolvedValueOnce({
      success: true,
      data: { id: 'post_888' },
    });
    updateChain = createUpdateChain([
      {
        ...pendingVideoRow,
        reviewStatus: 'accepted' as const,
        decidedAt: new Date(),
        scheduledSocialPostId: 'post_888',
      },
    ]);

    await expectResult(
      acceptBatchItem(mockDb as never, baseInput)
    ).toSucceedWith();

    // SAVE CREATES NO POST. Save and Schedule are two decisions, not one with
    // a date attached: saving keeps the content and commits to publishing
    // nothing, so a row in the socials queue would be a commitment the owner
    // never made. It also demanded a page — refusing every Save with "pick at
    // least one page" for a choice that belongs to scheduling.
    expect(createSocialPostMock).not.toHaveBeenCalled();
  });
});
