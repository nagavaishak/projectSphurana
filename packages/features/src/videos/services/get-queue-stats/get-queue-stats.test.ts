import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { mockQueue } from 'bullmq';
import { vi } from 'vitest';
import { getQueueStats } from './get-queue-stats.service.js';

// BullMQ is mocked via the canonical __mocks__/bullmq.ts alias.
const mockGetWaitingCount = mockQueue.getWaitingCount;
const mockGetActiveCount = mockQueue.getActiveCount;
const mockGetCompletedCount = mockQueue.getCompletedCount;
const mockGetFailedCount = mockQueue.getFailedCount;
const mockGetDelayedCount = mockQueue.getDelayedCount;
const mockIsPaused = mockQueue.isPaused;
const mockGetCompleted = mockQueue.getCompleted;

describe('getQueueStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWaitingCount.mockReset();
    mockGetActiveCount.mockReset();
    mockGetCompletedCount.mockReset();
    mockGetFailedCount.mockReset();
    mockGetDelayedCount.mockReset();
    mockIsPaused.mockReset();
    mockGetCompleted.mockReset();
  });

  it('should return queue statistics', async () => {
    mockGetWaitingCount.mockResolvedValueOnce(5);
    mockGetActiveCount.mockResolvedValueOnce(2);
    mockGetCompletedCount.mockResolvedValueOnce(100);
    mockGetFailedCount.mockResolvedValueOnce(3);
    mockGetDelayedCount.mockResolvedValueOnce(1);
    mockIsPaused.mockResolvedValueOnce(false);
    mockGetCompleted.mockResolvedValueOnce([]);

    const result = await getQueueStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waiting).toBe(5);
      expect(result.data.active).toBe(2);
      expect(result.data.completed).toBe(100);
      expect(result.data.failed).toBe(3);
      expect(result.data.delayed).toBe(1);
      expect(result.data.paused).toBe(false);
    }
  });

  it('should calculate average processing time from completed jobs', async () => {
    mockGetWaitingCount.mockResolvedValueOnce(0);
    mockGetActiveCount.mockResolvedValueOnce(0);
    mockGetCompletedCount.mockResolvedValueOnce(10);
    mockGetFailedCount.mockResolvedValueOnce(0);
    mockGetDelayedCount.mockResolvedValueOnce(0);
    mockIsPaused.mockResolvedValueOnce(false);
    mockGetCompleted.mockResolvedValueOnce([
      { processedOn: 1000, finishedOn: 3000 },
      { processedOn: 2000, finishedOn: 5000 },
      { processedOn: 3000, finishedOn: 4000 },
    ]);

    const result = await getQueueStats();

    expect(result.success).toBe(true);
    if (result.success) {
      // (2000 + 3000 + 1000) / 3 = 2000
      expect(result.data.avgProcessingTimeMs).toBe(2000);
    }
  });

  it('should return null avgProcessingTimeMs when no completed jobs', async () => {
    mockGetWaitingCount.mockResolvedValueOnce(0);
    mockGetActiveCount.mockResolvedValueOnce(0);
    mockGetCompletedCount.mockResolvedValueOnce(0);
    mockGetFailedCount.mockResolvedValueOnce(0);
    mockGetDelayedCount.mockResolvedValueOnce(0);
    mockIsPaused.mockResolvedValueOnce(false);
    mockGetCompleted.mockResolvedValueOnce([]);

    const result = await getQueueStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avgProcessingTimeMs).toBeNull();
    }
  });

  it('should return paused true when queue is paused', async () => {
    mockGetWaitingCount.mockResolvedValueOnce(0);
    mockGetActiveCount.mockResolvedValueOnce(0);
    mockGetCompletedCount.mockResolvedValueOnce(0);
    mockGetFailedCount.mockResolvedValueOnce(0);
    mockGetDelayedCount.mockResolvedValueOnce(0);
    mockIsPaused.mockResolvedValueOnce(true);
    mockGetCompleted.mockResolvedValueOnce([]);

    const result = await getQueueStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paused).toBe(true);
    }
  });

  it('should handle getCompleted error gracefully', async () => {
    mockGetWaitingCount.mockResolvedValueOnce(1);
    mockGetActiveCount.mockResolvedValueOnce(0);
    mockGetCompletedCount.mockResolvedValueOnce(5);
    mockGetFailedCount.mockResolvedValueOnce(0);
    mockGetDelayedCount.mockResolvedValueOnce(0);
    mockIsPaused.mockResolvedValueOnce(false);
    mockGetCompleted.mockRejectedValueOnce(new Error('Redis error'));

    const result = await getQueueStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waiting).toBe(1);
      expect(result.data.avgProcessingTimeMs).toBeNull();
    }
  });

  it('should skip jobs without processedOn or finishedOn in avg calculation', async () => {
    mockGetWaitingCount.mockResolvedValueOnce(0);
    mockGetActiveCount.mockResolvedValueOnce(0);
    mockGetCompletedCount.mockResolvedValueOnce(3);
    mockGetFailedCount.mockResolvedValueOnce(0);
    mockGetDelayedCount.mockResolvedValueOnce(0);
    mockIsPaused.mockResolvedValueOnce(false);
    mockGetCompleted.mockResolvedValueOnce([
      { processedOn: 1000, finishedOn: 2000 },
      { processedOn: null, finishedOn: 3000 },
      { processedOn: 2000, finishedOn: null },
    ]);

    const result = await getQueueStats();

    expect(result.success).toBe(true);
    if (result.success) {
      // Only first job has both timestamps: (2000 - 1000) / 1 = 1000
      expect(result.data.avgProcessingTimeMs).toBe(1000);
    }
  });
});
