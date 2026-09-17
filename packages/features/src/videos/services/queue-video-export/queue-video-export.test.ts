import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { mockQueue } from 'bullmq';
import { type MockInstance, afterEach, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as selectStockBRollModule from '../../../stock-footage/services/select-stock-broll/select-stock-broll.service.js';
import {
  failedBrollClipsMessage,
  pendingBrollClipsMessage,
  queueVideoExport,
  unavailableBrollClipsMessage,
} from './queue-video-export.service.js';

// BullMQ is mocked via the canonical __mocks__/bullmq.ts alias.
const mockQueueAdd = mockQueue.add;

// Restored `vi.spyOn` on the SOURCE module, not `vi.mock` of the barrel: under
// `isolate: false` the worker shares one module graph, so a hoisted factory
// leaks into every later file and silently misses once an earlier file has
// imported the real module. Barrel re-exports are live getters and can't be spied.
let mockSelectStockBRoll: MockInstance;

describe('queueVideoExport', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockQueueAdd.mockReset();
    mockSelectStockBRoll = vi
      .spyOn(selectStockBRollModule, 'selectStockBRoll')
      .mockResolvedValue({ success: true, data: [] } as never);
    mockDb.query.asset.findMany.mockResolvedValue([
      { id: 'asset_1', transcodeStatus: 'ready' },
      { id: 'stock_a1', transcodeStatus: 'ready' },
      { id: 'generic_stock_a1', transcodeStatus: 'ready' },
    ]);
  });

  afterEach(() => {
    mockSelectStockBRoll.mockRestore();
  });

  const validInput = {
    id: 'video_123',
  };

  const validDraftConfig = {
    narrationType: 'recorded' as const,
    talkingHeadUrl: 'https://example.com/talking-head.mp4',
    scriptText: 'Test script',
    bRollClips: [{ assetId: 'asset_1', url: '', order: 0 }],
    captions: {
      enabled: true,
      position: 'bottom' as const,
      fontFamily: 'Inter',
      fontSize: 64,
      textColor: '#FFFFFF',
      highlightColor: '#39E508',
      backgroundColor: '#000000',
      showBackground: false,
    },
    musicVolume: 0.5,
    outro: {
      businessName: 'Test Business',
      ctaText: 'Book Now',
      backgroundOpacity: 0.7,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
      durationSec: 3,
    },
    orientation: 'portrait' as const,
  };

  it('should queue video for export when in draft status', async () => {
    const draftVideo = {
      id: 'video_123',
      title: 'Test Video',
      status: 'draft',
      organizationId: 'org_123',
      draftConfig: validDraftConfig,
    };

    const queuedVideo = {
      ...draftVideo,
      status: 'queued',
      progress: 0,
      errorMessage: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([queuedVideo]);
    mockQueueAdd.mockResolvedValueOnce({ id: 'job_123' });

    const result = await queueVideoExport(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('queued');
      expect(result.data.progress).toBe(0);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({
        videoId: 'video_123',
        draftConfig: draftVideo.draftConfig,
      }),
      expect.objectContaining({ jobId: 'video_123' })
    );
  });

  it('should clear previous error message when queuing', async () => {
    const videoWithError = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_123',
      errorMessage: 'Previous error',
      draftConfig: validDraftConfig,
    };

    const queuedVideo = {
      ...videoWithError,
      status: 'queued',
      errorMessage: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoWithError]);
    mockDb.returning.mockResolvedValueOnce([queuedVideo]);
    mockQueueAdd.mockResolvedValueOnce({ id: 'job_123' });

    const result = await queueVideoExport(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorMessage).toBeNull();
    }
  });

  it('auto-fills b-roll from stock when org has a service but no uploads', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_1',
      serviceId: 'svc_1',
      createdById: 'user_1',
      variationId: 'educational-1',
      draftConfig: {
        ...validDraftConfig,
        narrationType: 'ai_voiceover' as const,
        aiVoiceId: 'voice_1',
        scriptText: 'script',
        bRollClips: [],
      },
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([
      { ...draftVideo, status: 'queued' },
    ]);
    mockSelectStockBRoll.mockResolvedValueOnce({
      success: true,
      data: [{ assetId: 'stock_a1', order: 0, clipType: 'bRoll' }],
    });
    mockQueueAdd.mockResolvedValueOnce({ id: 'job_123' });

    const result = await queueVideoExport(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockSelectStockBRoll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        serviceId: 'svc_1',
        uploadedById: 'user_1',
      })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({
        draftConfig: expect.objectContaining({
          bRollClips: [{ assetId: 'stock_a1', order: 0, clipType: 'bRoll' }],
        }),
      }),
      expect.objectContaining({ jobId: 'video_123' })
    );
  });

  it('auto-fills b-roll from generic stock when no service is selected', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_1',
      serviceId: null,
      createdById: 'user_1',
      variationId: 'authority-2',
      draftConfig: {
        ...validDraftConfig,
        narrationType: 'ai_voiceover' as const,
        aiVoiceId: 'voice_1',
        scriptText: 'script',
        bRollClips: [],
      },
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([
      { ...draftVideo, status: 'queued' },
    ]);
    mockSelectStockBRoll.mockResolvedValueOnce({
      success: true,
      data: [{ assetId: 'generic_stock_a1', order: 0, clipType: 'bRoll' }],
    });
    mockQueueAdd.mockResolvedValueOnce({ id: 'job_123' });

    const result = await queueVideoExport(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockSelectStockBRoll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        serviceId: null,
        uploadedById: 'user_1',
      })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({
        draftConfig: expect.objectContaining({
          bRollClips: [
            { assetId: 'generic_stock_a1', order: 0, clipType: 'bRoll' },
          ],
        }),
      }),
      expect.objectContaining({ jobId: 'video_123' })
    );
  });

  it('auto-fills empty b-roll even when the stock footage toggle is off', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_1',
      serviceId: 'svc_1',
      createdById: 'user_1',
      variationId: 'authority-1',
      draftConfig: {
        ...validDraftConfig,
        narrationType: 'ai_voiceover' as const,
        aiVoiceId: 'voice_1',
        scriptText: 'script',
        bRollClips: [],
      },
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.returning.mockResolvedValueOnce([
      { ...draftVideo, status: 'queued' },
    ]);
    mockSelectStockBRoll.mockResolvedValueOnce({
      success: true,
      data: [{ assetId: 'stock_a1', order: 0, clipType: 'bRoll' }],
    });
    mockQueueAdd.mockResolvedValueOnce({ id: 'job_123' });

    const result = await queueVideoExport(mockDb as never, {
      ...validInput,
      allowStockFootage: false,
    });

    expect(result.success).toBe(true);
    expect(mockSelectStockBRoll).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({
        draftConfig: expect.objectContaining({
          bRollClips: [{ assetId: 'stock_a1', order: 0, clipType: 'bRoll' }],
        }),
      }),
      expect.objectContaining({ jobId: 'video_123' })
    );
  });

  it('does NOT auto-fill before/after templates (real results only)', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_1',
      serviceId: 'svc_1',
      createdById: 'user_1',
      variationId: 'before-after-1',
      draftConfig: {
        ...validDraftConfig,
        narrationType: 'ai_voiceover' as const,
        aiVoiceId: 'voice_1',
        scriptText: 'script',
        bRollClips: [],
      },
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    expect(mockSelectStockBRoll).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when video does not exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Video not found');
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE for non-draft video', async () => {
    const processingVideo = {
      id: 'video_123',
      status: 'processing',
      draftConfig: validDraftConfig,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([processingVideo]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('processing');
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('rejects an export request for a ready video without enqueueing a second render', async () => {
    const readyVideo = {
      id: 'video_123',
      status: 'ready',
      draftConfig: validDraftConfig,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([readyVideo]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toBe(
        'Video cannot be queued. Current status: ready'
      );
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE for queued video', async () => {
    const queuedVideo = {
      id: 'video_123',
      status: 'queued',
      draftConfig: validDraftConfig,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([queuedVideo]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
    });
  });

  it('should return VALIDATION_ERROR when no draft config', async () => {
    const videoWithoutConfig = {
      id: 'video_123',
      status: 'draft',
      draftConfig: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoWithoutConfig]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.message).toContain('draft configuration');
    });

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('reports a processing b-roll clip as pending', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      draftConfig: validDraftConfig,
    };
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      { id: 'asset_1', transcodeStatus: 'pending' },
    ]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toBe(pendingBrollClipsMessage);
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('rejects b-roll asset IDs that no longer resolve instead of queueing a blank render', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_123',
      draftConfig: {
        ...validDraftConfig,
        narrationType: 'text_only' as const,
        talkingHeadUrl: null,
        textFrames: [{ id: 'frame_1', text: 'Visible copy', durationSec: 3 }],
        bRollClips: [{ assetId: 'deleted_asset', order: 0 }],
      },
    };
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.query.asset.findMany.mockResolvedValueOnce([]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error.message).toBe(unavailableBrollClipsMessage);
      expect(error.details).toMatchObject({
        unavailableAssetIds: ['deleted_asset'],
      });
    });

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('reports a failed b-roll transcode as failed instead of asking the user to wait', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      draftConfig: validDraftConfig,
    };
    mockDb.limit.mockResolvedValueOnce([draftVideo]);
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      { id: 'asset_1', transcodeStatus: 'failed' },
    ]);

    await expectResult(
      queueVideoExport(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toBe(failedBrollClipsMessage);
    });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {};

    await expectResult(
      queueVideoExport(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
