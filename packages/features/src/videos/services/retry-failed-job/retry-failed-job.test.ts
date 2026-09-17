import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { mockQueue } from 'bullmq';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { retryFailedJob } from './retry-failed-job.service.js';

// BullMQ is mocked via the canonical __mocks__/bullmq.ts alias.
const mockQueueAdd = mockQueue.add;
const mockGetJob = mockQueue.getJob;

/**
 * A legacy-shaped config that today's `isDraftConfigComplete` would reject.
 * Retry must still accept it — the retry gate checks b-roll resolution only.
 */
const legacyDraftConfig = { hook: 'Test', script: 'Script', cta: 'CTA' };

const bRollDraftConfig = {
  ...legacyDraftConfig,
  bRollClips: [{ assetId: 'asset_1', order: 0 }],
};

describe('retryFailedJob', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockQueueAdd.mockReset();
    mockGetJob.mockReset();
    mockDb.query.asset.findMany.mockResolvedValue([
      { id: 'asset_1', transcodeStatus: 'ready' },
    ]);
  });

  const validInput = { videoId: 'video_123' };

  it('should retry a failed video job', async () => {
    const failedVideo = {
      id: 'video_123',
      status: 'failed',
      organizationId: 'org_123',
      variationId: 'var_1',
      draftConfig: legacyDraftConfig,
      errorMessage: 'Previous error',
    };
    const updatedVideo = {
      ...failedVideo,
      status: 'queued',
      progress: 0,
      errorMessage: null,
      processingStage: null,
      stageStartedAt: null,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([failedVideo]);
    mockGetJob.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);
    mockQueueAdd.mockResolvedValueOnce({ id: 'video_123' });

    const result = await retryFailedJob(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('queued');
      expect(result.data.progress).toBe(0);
      expect(result.data.errorMessage).toBeNull();
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({
        videoId: 'video_123',
        organizationId: 'org_123',
        draftConfig: failedVideo.draftConfig,
      }),
      expect.objectContaining({ jobId: 'video_123' })
    );
  });

  it('should remove existing failed job before adding new one', async () => {
    const failedVideo = {
      id: 'video_123',
      status: 'failed',
      organizationId: 'org_123',
      variationId: null,
      draftConfig: legacyDraftConfig,
    };
    const updatedVideo = {
      ...failedVideo,
      status: 'queued',
      progress: 0,
      errorMessage: null,
    };

    const mockExistingJob = { remove: vi.fn().mockResolvedValue(undefined) };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([failedVideo]);
    mockGetJob.mockResolvedValueOnce(mockExistingJob);
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);
    mockQueueAdd.mockResolvedValueOnce({ id: 'video_123' });

    const result = await retryFailedJob(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockExistingJob.remove).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when video does not exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      retryFailedJob(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE for non-failed video', async () => {
    const draftVideo = {
      id: 'video_123',
      status: 'draft',
      organizationId: 'org_123',
      draftConfig: { hook: 'Test' },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([draftVideo]);

    await expectResult(retryFailedJob(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('draft');
      }
    );

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE for processing video', async () => {
    const processingVideo = {
      id: 'video_123',
      status: 'processing',
      organizationId: 'org_123',
      draftConfig: { hook: 'Test' },
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([processingVideo]);

    await expectResult(retryFailedJob(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      }
    );
  });

  it('should return VALIDATION_ERROR when video has no draft config', async () => {
    const failedVideo = {
      id: 'video_123',
      status: 'failed',
      organizationId: 'org_123',
      draftConfig: null,
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([failedVideo]);

    await expectResult(retryFailedJob(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('draft configuration');
      }
    );

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('does not retry a v1 text-only render whose b-roll asset is unavailable', async () => {
    const failedVideo = {
      id: 'video_123',
      status: 'failed',
      organizationId: 'org_123',
      variationId: 'educational-1',
      draftConfig: bRollDraftConfig,
    };
    mockDb.limit.mockResolvedValueOnce([failedVideo]);
    mockDb.query.asset.findMany.mockResolvedValueOnce([]);

    await expectResult(retryFailedJob(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('no longer available');
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing videoId', async () => {
    await expectResult(
      retryFailedJob(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty videoId', async () => {
    await expectResult(
      retryFailedJob(mockDb as never, { videoId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
