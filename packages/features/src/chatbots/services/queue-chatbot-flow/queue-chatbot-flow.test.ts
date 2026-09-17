import { mockQueue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  cancelPendingFlow,
  cancelPendingFollowUp,
  cancelPendingMessageParts,
  cancelResponseTimeout,
  queueChatbotFlow,
} from './queue-chatbot-flow.service.js';

// BullMQ is mocked via the canonical __mocks__/bullmq.ts alias.
const mockAdd = mockQueue.add;
const mockGetJob = mockQueue.getJob;
const mockGetDelayed = mockQueue.getDelayed;
const mockGetWaiting = mockQueue.getWaiting;

describe('queueChatbotFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'job-123' });
    mockGetDelayed.mockResolvedValue([]);
    mockGetWaiting.mockResolvedValue([]);
  });

  it('should queue a message trigger job', async () => {
    const result = await queueChatbotFlow({
      conversationId: 'conv-1',
      userMessage: 'Hello',
      triggerType: 'message',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobId).toBeDefined();
    }
    expect(mockAdd).toHaveBeenCalledWith(
      'execute-flow',
      expect.objectContaining({
        conversationId: 'conv-1',
        userMessage: 'Hello',
        triggerType: 'message',
        queuedAt: expect.any(String),
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^flow-conv-1-\d+$/),
      })
    );
  });

  it('should use predictable jobId for timeout trigger', async () => {
    const result = await queueChatbotFlow({
      conversationId: 'conv-1',
      triggerType: 'timeout',
      delayMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(mockAdd).toHaveBeenCalledWith(
      'execute-flow',
      expect.objectContaining({ triggerType: 'timeout' }),
      expect.objectContaining({
        jobId: 'timeout-conv-1',
        delay: 5000,
      })
    );
  });

  it('should use predictable jobId for deliver_part trigger', async () => {
    await queueChatbotFlow({
      conversationId: 'conv-1',
      triggerType: 'deliver_part',
      pendingMessageParts: ['A', 'B'],
      currentPartIndex: 1,
      delayMs: 10000,
    });

    expect(mockAdd).toHaveBeenCalledWith(
      'execute-flow',
      expect.objectContaining({
        triggerType: 'deliver_part',
        pendingMessageParts: ['A', 'B'],
        currentPartIndex: 1,
      }),
      expect.objectContaining({
        jobId: 'msg-conv-1-1',
        delay: 10000,
      })
    );
  });

  it('should use predictable jobId for follow_up trigger', async () => {
    await queueChatbotFlow({
      conversationId: 'conv-1',
      triggerType: 'follow_up',
      delayMs: 3600000,
    });

    expect(mockAdd).toHaveBeenCalledWith(
      'execute-flow',
      expect.anything(),
      expect.objectContaining({ jobId: 'followup-conv-1' })
    );
  });

  it('should use predictable jobId for expire trigger', async () => {
    await queueChatbotFlow({
      conversationId: 'conv-1',
      triggerType: 'expire',
      delayMs: 86400000,
    });

    expect(mockAdd).toHaveBeenCalledWith(
      'execute-flow',
      expect.anything(),
      expect.objectContaining({ jobId: 'expire-conv-1' })
    );
  });

  it('should return VALIDATION_ERROR for empty conversationId', async () => {
    const result = await queueChatbotFlow({
      conversationId: '',
      triggerType: 'message',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return INTERNAL_ERROR when queue fails', async () => {
    mockAdd.mockRejectedValueOnce(new Error('Redis connection lost'));

    const result = await queueChatbotFlow({
      conversationId: 'conv-1',
      triggerType: 'message',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});

describe('cancelResponseTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove a delayed timeout job', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    mockGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('delayed'),
      remove: mockRemove,
    });

    await cancelResponseTimeout('conv-1');

    expect(mockGetJob).toHaveBeenCalledWith('timeout-conv-1');
    expect(mockRemove).toHaveBeenCalled();
  });

  it('should not fail if job does not exist', async () => {
    mockGetJob.mockResolvedValueOnce(null);

    await expect(cancelResponseTimeout('conv-1')).resolves.not.toThrow();
  });
});

describe('cancelPendingMessageParts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove all pending message part jobs', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    mockGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('delayed'),
      remove: mockRemove,
    });

    await cancelPendingMessageParts('conv-1');

    // Should check 4 job IDs (msg-conv-1-0 through msg-conv-1-3)
    expect(mockGetJob).toHaveBeenCalledTimes(4);
  });
});

describe('cancelPendingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDelayed.mockResolvedValue([]);
    mockGetWaiting.mockResolvedValue([]);
  });

  it('should remove delayed flow jobs matching the conversation', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    mockGetDelayed.mockResolvedValueOnce([
      { id: 'flow-conv-1-1234567890', remove: mockRemove },
    ]);

    await cancelPendingFlow('conv-1');

    expect(mockRemove).toHaveBeenCalled();
  });

  it('should remove waiting flow jobs matching the conversation', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    mockGetWaiting.mockResolvedValueOnce([
      { id: 'flow-conv-1-1234567890', remove: mockRemove },
    ]);

    await cancelPendingFlow('conv-1');

    expect(mockRemove).toHaveBeenCalled();
  });

  it('should not remove jobs for other conversations', async () => {
    const mockRemove = vi.fn();
    mockGetDelayed.mockResolvedValueOnce([
      { id: 'flow-conv-2-1234567890', remove: mockRemove },
    ]);

    await cancelPendingFlow('conv-1');

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('should not fail if no jobs exist', async () => {
    await expect(cancelPendingFlow('conv-1')).resolves.not.toThrow();
  });
});

describe('cancelPendingFollowUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove both followup and expire jobs', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    mockGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: mockRemove,
    });

    await cancelPendingFollowUp('conv-1');

    expect(mockGetJob).toHaveBeenCalledWith('followup-conv-1');
    expect(mockGetJob).toHaveBeenCalledWith('expire-conv-1');
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});
