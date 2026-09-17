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
import { requestMonthlyBatch } from './request-monthly-batch.service.js';

const input = {
  organizationId: 'org_123',
  createdById: 'user_123',
  periodMonth: '2026-07',
  graphicCount: 6,
  videoCount: 6,
  replace: true,
  serviceIds: ['service_123'],
  allowStockFootage: true,
};

describe('requestMonthlyBatch', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockQueue.getJob.mockResolvedValue(undefined);
    mockQueue.add.mockResolvedValue({ id: 'content-batch-batch_123' });
  });

  it('hard-fails a no-media batch when stock footage is disabled', async () => {
    mockDb.where
      .mockResolvedValueOnce([{ id: 'service_123' }]) // active services
      .mockResolvedValueOnce([]) // graphic media
      .mockResolvedValueOnce([]); // video media

    await expectResult(
      requestMonthlyBatch(mockDb as never, {
        ...input,
        allowStockFootage: false,
      })
    ).toFailWithCode(ErrorCodes.INVALID_STATE);

    expect(mockDb.query.contentBatch.findFirst).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('falls back to stock video when stock is enabled and no video is uploaded', async () => {
    mockDb.where
      .mockResolvedValueOnce([{ id: 'service_123' }]) // active services
      .mockResolvedValueOnce([]) // graphic media: none
      .mockResolvedValueOnce([]); // video media: none
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'batch_123',
        organizationId: 'org_123',
        periodMonth: '2026-07',
        status: 'planning',
      },
    ]);

    const result = await requestMonthlyBatch(mockDb as never, input);

    // No uploaded media at all, but stock is on: BOTH modalities fall back.
    // Videos come from the curated bank; graphics come from the slot ladder's
    // lower tiers (stock-image, then ai-generated).
    //
    // This asserted graphics were 0 — "graphics still need an uploaded image".
    // That was true before resolve-slot-image gained those tiers, and the gap
    // shipped as a silent zero: an org with no uploaded photo asked for six
    // graphics and got none, with nothing on the batch row to say why.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effectiveGraphicCount).toBe(6);
      expect(result.data.effectiveVideoCount).toBe(6);
    }
    expect(mockQueue.add).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({ videoCount: 6, allowStockFootage: true }),
      expect.anything()
    );
  });

  it('queues the honest modality mix after preparation', async () => {
    mockDb.where
      .mockResolvedValueOnce([{ id: 'service_123' }])
      .mockResolvedValueOnce([{ serviceId: 'service_123' }])
      .mockResolvedValueOnce([]);
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'batch_123',
        organizationId: 'org_123',
        periodMonth: '2026-07',
        status: 'planning',
      },
    ]);

    const result = await requestMonthlyBatch(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.queued).toBe(true);
      expect(result.data.effectiveGraphicCount).toBe(6);
      // Has an uploaded image (6 graphics); no uploaded video, but stock is on,
      // so the 6 video slots are filled from the stock bank.
      expect(result.data.effectiveVideoCount).toBe(6);
    }
    expect(mockQueue.add).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({
        batchId: expect.any(String),
        graphicCount: 6,
        videoCount: 6,
        serviceIds: ['service_123'],
        allowStockFootage: true,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^content-batch-/),
        attempts: 3,
      })
    );
  });

  it('persists a terminal failure when enqueueing fails', async () => {
    mockDb.where
      .mockResolvedValueOnce([{ id: 'service_123' }])
      .mockResolvedValueOnce([{ serviceId: 'service_123' }])
      .mockResolvedValueOnce([{ serviceId: 'service_123' }]);
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'batch_123',
        organizationId: 'org_123',
        periodMonth: '2026-07',
        status: 'planning',
      },
    ]);
    // Every attempt fails (the service retries a transient blip before giving
    // up), so the enqueue is genuinely terminal.
    mockQueue.add.mockRejectedValue(new Error('Redis unavailable'));

    const result = await requestMonthlyBatch(mockDb as never, input);

    expect(result.success).toBe(false);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('Failed to queue'),
      })
    );
  });
});
