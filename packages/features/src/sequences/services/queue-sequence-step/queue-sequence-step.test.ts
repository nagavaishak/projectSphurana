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
import {
  moveToSequenceDLQ,
  queueFirstStep,
  queueSequenceStep,
} from './queue-sequence-step.service.js';

// BullMQ is mocked via the canonical __mocks__/bullmq.ts alias.
const mockAdd = mockQueue.add;

describe('queueSequenceStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'job-123' });
  });

  it('returns VALIDATION_ERROR for missing leadId', async () => {
    await expectResult(
      queueSequenceStep({
        leadId: '',
        sequenceId: 'seq-1',
        organizationId: 'org-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing sequenceId', async () => {
    await expectResult(
      queueSequenceStep({
        leadId: 'lead-1',
        sequenceId: '',
        organizationId: 'org-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      queueSequenceStep({
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for negative delayMs', async () => {
    await expectResult(
      queueSequenceStep({
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        organizationId: 'org-1',
        delayMs: -1,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  // The `sequence-execution` queue has a producer and NO worker anywhere — the
  // only orphan of the workspace's 18 queues. It is declared `disabled` in the
  // job registry (sequences are deprecated), so this producer must REFUSE
  // rather than enqueue a step that would silently never run. These tests used
  // to assert the opposite: that a step was enqueued successfully — i.e. they
  // asserted the loaded gun.
  it('refuses to enqueue while the queue is declared disabled', async () => {
    const result = await queueSequenceStep({
      leadId: 'lead-1',
      sequenceId: 'seq-1',
      organizationId: 'org-1',
      stepId: 'step-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(result.error.message).toContain('would never run');
    }
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('queueFirstStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'job-first-1' });
  });

  it('returns VALIDATION_ERROR for missing leadId', async () => {
    await expectResult(
      queueFirstStep({
        leadId: '',
        sequenceId: 'seq-1',
        organizationId: 'org-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses to enqueue while the queue is declared disabled', async () => {
    const result = await queueFirstStep({
      leadId: 'lead-1',
      sequenceId: 'seq-1',
      organizationId: 'org-1',
      delayMs: 5000,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('moveToSequenceDLQ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'dlq-job-1' });
  });

  it('moves a failed job to the DLQ successfully', async () => {
    const result = await moveToSequenceDLQ({
      id: 'failed-job-1',
      data: {
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        organizationId: 'org-1',
      },
      failedReason: 'Max retries exceeded',
      attemptsMade: 3,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dlqJobId).toBe('dlq-job-1');
    }
  });

  it('returns INTERNAL_ERROR when DLQ queue fails', async () => {
    mockAdd.mockRejectedValueOnce(new Error('Redis error'));

    const result = await moveToSequenceDLQ({
      id: 'failed-job-1',
      data: {
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        organizationId: 'org-1',
      },
      failedReason: 'Error',
      attemptsMade: 3,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
