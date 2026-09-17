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
import { getVideoJobStatus } from './get-job-status.service.js';

// BullMQ is mocked via the canonical __mocks__/bullmq.ts alias.
const mockGetJob = mockQueue.getJob;
const mockGetWaiting = mockQueue.getWaiting;

describe('getVideoJobStatus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGetJob.mockReset();
    mockGetWaiting.mockReset();
  });

  const validInput = { videoId: 'video_123' };

  it('should return job status from queue when job exists and is active', async () => {
    const videoRecord = {
      id: 'video_123',
      status: 'processing',
      processingStage: 'rendering',
      stageStartedAt: new Date('2024-01-15T12:00:00Z'),
      progress: 50,
      errorMessage: null,
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoRecord]);

    const mockJob = {
      id: 'video_123',
      progress: 75,
      failedReason: null,
      processedOn: 1705312800000,
      finishedOn: null,
      getState: vi.fn().mockResolvedValue('active'),
    };
    mockGetJob.mockResolvedValueOnce(mockJob);

    const result = await getVideoJobStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobId).toBe('video_123');
      expect(result.data.state).toBe('active');
      expect(result.data.progress).toBe(75);
      expect(result.data.processingStage).toBe('rendering');
      expect(result.data.processedOn).toBe(1705312800000);
    }
  });

  it('should return queue position when job is waiting', async () => {
    const videoRecord = {
      id: 'video_123',
      status: 'queued',
      processingStage: null,
      stageStartedAt: null,
      progress: 0,
      errorMessage: null,
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoRecord]);

    const mockJob = {
      id: 'video_123',
      progress: 0,
      failedReason: null,
      processedOn: null,
      finishedOn: null,
      getState: vi.fn().mockResolvedValue('waiting'),
    };
    mockGetJob.mockResolvedValueOnce(mockJob);
    mockGetWaiting.mockResolvedValueOnce([
      { id: 'other_video' },
      { id: 'video_123' },
      { id: 'another_video' },
    ]);

    const result = await getVideoJobStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('waiting');
      expect(result.data.queuePosition).toBe(2);
    }
  });

  it('should return status from database when no job in queue', async () => {
    const videoRecord = {
      id: 'video_123',
      status: 'ready',
      processingStage: null,
      stageStartedAt: null,
      progress: 100,
      errorMessage: null,
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoRecord]);
    mockGetJob.mockResolvedValueOnce(null);

    const result = await getVideoJobStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('completed');
      expect(result.data.progress).toBe(100);
      expect(result.data.queuePosition).toBeNull();
    }
  });

  it('should map failed video status to failed job state', async () => {
    const videoRecord = {
      id: 'video_123',
      status: 'failed',
      processingStage: 'rendering',
      stageStartedAt: new Date(),
      progress: 60,
      errorMessage: 'Out of memory',
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoRecord]);
    mockGetJob.mockResolvedValueOnce(null);

    const result = await getVideoJobStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('failed');
      expect(result.data.failedReason).toBe('Out of memory');
    }
  });

  it('should return NOT_FOUND when video does not exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      getVideoJobStatus(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing videoId', async () => {
    await expectResult(
      getVideoJobStatus(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty videoId', async () => {
    await expectResult(
      getVideoJobStatus(mockDb as never, { videoId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return failed reason from job when available', async () => {
    const videoRecord = {
      id: 'video_123',
      status: 'failed',
      processingStage: null,
      stageStartedAt: null,
      progress: 0,
      errorMessage: 'DB error message',
    };
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([videoRecord]);

    const mockJob = {
      id: 'video_123',
      progress: 0,
      failedReason: 'Job failed reason',
      processedOn: null,
      finishedOn: null,
      getState: vi.fn().mockResolvedValue('failed'),
    };
    mockGetJob.mockResolvedValueOnce(mockJob);

    const result = await getVideoJobStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.failedReason).toBe('Job failed reason');
    }
  });
});
