import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { mockQueue } from 'bullmq';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { queueMonthlyBatch } from './queue-monthly-batch.service.js';

const payload = {
  batchId: 'batch_123',
  organizationId: 'org_123',
  periodMonth: '2026-07',
  createdById: 'user_123',
  graphicCount: 6,
  videoCount: 6,
  serviceIds: ['service_123'],
  allowStockFootage: true,
  videoPositionOffset: 0,
  graphicPositionOffset: 0,
  markFailedOnError: true,
};

describe('queueMonthlyBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue.getJob.mockResolvedValue(undefined);
    mockQueue.add.mockResolvedValue({ id: 'content-batch-batch_123' });
  });

  it('uses a deterministic batch job id with retries', async () => {
    const result = await queueMonthlyBatch(payload);

    expect(result.success).toBe(true);
    expect(mockQueue.add).toHaveBeenCalledWith('generate', payload, {
      jobId: 'content-batch-batch_123',
      attempts: 3,
    });
  });

  it('collapses another click onto an in-flight job', async () => {
    mockQueue.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
      remove: vi.fn(),
    });

    const result = await queueMonthlyBatch(payload);

    expect(result.success).toBe(true);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('removes a terminal job so a failed batch can be retried', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
      remove,
    });

    const result = await queueMonthlyBatch(payload);

    expect(result.success).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(mockQueue.add).toHaveBeenCalledOnce();
  });

  it('reports queue failure instead of claiming the batch was queued', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('Redis unavailable'));

    await expectResult(queueMonthlyBatch(payload)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
  });
});
