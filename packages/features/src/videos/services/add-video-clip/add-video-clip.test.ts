import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
// Spy the SOURCE module, not the `queue-video-export/index.js` barrel: barrel
// re-exports are live getters under Vite SSR and cannot be redefined, and a
// bare `vi.mock` factory would persist on the shared worker module graph.
import * as queueVideoExportModule from '../queue-video-export/queue-video-export.service.js';

let mockQueueVideoExport: MockInstance;

// The real `../../templates/index.js` barrel is used on purpose: it is pure
// data + pure lookup helpers, and every fixture below has `variationId: null`,
// so `getVariationById` returns `null` naturally. Under `isolate: false` a
// file-local `vi.mock` of this internal barrel would persist on the shared
// worker graph and delete every export the factory omitted for later files.

import { addVideoClip } from './add-video-clip.service.js';

describe('addVideoClip', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockQueueVideoExport = vi.spyOn(
      queueVideoExportModule,
      'queueVideoExport'
    ) as unknown as MockInstance;
    // Default stub so no test can fall through to the real BullMQ enqueue.
    mockQueueVideoExport.mockReset();
    mockQueueVideoExport.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    mockQueueVideoExport.mockRestore();
  });

  const validTalkingHeadInput = {
    videoId: 'video_123',
    slotType: 'talkingHead' as const,
    assetId: 'asset_456',
    url: 'https://example.com/talking-head.mp4',
  };

  const validBRollInput = {
    videoId: 'video_123',
    slotType: 'bRoll' as const,
    assetId: 'asset_789',
    url: 'https://example.com/b-roll.mp4',
    order: 1,
    clipType: 'bRoll' as const,
  };

  it('should add talking head clip to a draft video', async () => {
    const draftVideo = {
      id: 'video_123',
      title: 'Test Video',
      status: 'draft',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: null,
    };
    const updatedVideo = {
      ...draftVideo,
      draftConfig: {
        talkingHeadAssetId: 'asset_456',
        talkingHeadUrl: 'https://example.com/talking-head.mp4',
      },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await addVideoClip(mockDb as never, validTalkingHeadInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.video.id).toBe('video_123');
      expect(result.data.slotStatus.videoId).toBe('video_123');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should add b-roll clip to a draft video', async () => {
    const draftVideo = {
      id: 'video_123',
      title: 'Test Video',
      status: 'draft',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: { bRollClips: [] },
    };
    const updatedVideo = {
      ...draftVideo,
      draftConfig: {
        bRollClips: [
          {
            assetId: 'asset_789',
            url: 'https://example.com/b-roll.mp4',
            order: 1,
            clipType: 'bRoll',
          },
        ],
      },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await addVideoClip(mockDb as never, validBRollInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.video.id).toBe('video_123');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when video does not exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);
    await expectResult(
      addVideoClip(mockDb as never, validTalkingHeadInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return INVALID_STATE for non-draft video', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'video_123',
        title: 'Test',
        status: 'processing',
        variationId: null,
        thumbnailUrl: null,
        draftConfig: null,
      },
    ]);
    await expectResult(
      addVideoClip(mockDb as never, validTalkingHeadInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('processing');
    });
  });

  it('should return VALIDATION_ERROR for missing videoId', async () => {
    await expectResult(
      addVideoClip(
        mockDb as never,
        {
          slotType: 'talkingHead',
          assetId: 'a',
          url: 'https://example.com/x.mp4',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid URL', async () => {
    await expectResult(
      addVideoClip(mockDb as never, {
        videoId: 'v1',
        slotType: 'talkingHead' as const,
        assetId: 'a',
        url: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should auto-queue when all slots are complete', async () => {
    const draftVideo = {
      id: 'video_123',
      title: 'Test',
      status: 'draft',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: null,
    };
    const updatedVideo = {
      ...draftVideo,
      draftConfig: {
        talkingHeadAssetId: 'asset_456',
        talkingHeadUrl: 'https://example.com/talking-head.mp4',
      },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);
    mockQueueVideoExport.mockResolvedValueOnce({
      success: true,
      data: updatedVideo,
    });
    const result = await addVideoClip(mockDb as never, validTalkingHeadInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoQueued).toBe(true);
    }
  });

  it('should not fail when auto-queue throws', async () => {
    const draftVideo = {
      id: 'video_123',
      title: 'Test',
      status: 'draft',
      variationId: null,
      thumbnailUrl: null,
      draftConfig: null,
    };
    const updatedVideo = {
      ...draftVideo,
      draftConfig: {
        talkingHeadAssetId: 'asset_456',
        talkingHeadUrl: 'https://example.com/talking-head.mp4',
      },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);
    mockQueueVideoExport.mockRejectedValueOnce(new Error('Queue error'));
    const result = await addVideoClip(mockDb as never, validTalkingHeadInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoQueued).toBe(false);
    }
  });
});
