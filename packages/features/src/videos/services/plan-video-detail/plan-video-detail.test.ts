import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { planVideoDetail } from './plan-video-detail.service.js';

/**
 * Focused validation-layer tests. The service's success path exercises
 * createVideo, queueVideoExport, two AI calls, and asset listing — those
 * paths are covered by the existing integration tests around
 * `generateMonthlyBatch`. Here we only assert the input contract is
 * enforced so the dispatcher / cron can rely on it for fast failure.
 */

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';

const baseInput = {
  organizationId: VALID_ID,
  createdById: VALID_ID,
  batchId: VALID_ID,
  periodMonth: '2026-01',
  targetServiceId: VALID_ID,
  topicSummary: 'How laser hair removal works for sensitive skin',
  position: 0,
  scheduledAt: new Date('2026-01-02T10:00:00.000Z'),
  targetPageIds: [],
};

describe('planVideoDetail validation', () => {
  it('rejects missing organizationId', async () => {
    const result = await planVideoDetail(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      undefined as never,
      { ...baseInput, organizationId: '' } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects bad periodMonth format', async () => {
    const result = await planVideoDetail(
      undefined as never,
      {
        ...baseInput,
        periodMonth: '2026-13',
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects missing topicSummary', async () => {
    const result = await planVideoDetail(
      undefined as never,
      {
        ...baseInput,
        topicSummary: '',
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects negative position', async () => {
    const result = await planVideoDetail(
      undefined as never,
      {
        ...baseInput,
        position: -1,
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects scheduledAt as string', async () => {
    const result = await planVideoDetail(
      undefined as never,
      {
        ...baseInput,
        scheduledAt: '2026-01-02T10:00:00Z',
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects a regeneration block with an empty previousItemId', async () => {
    const result = await planVideoDetail(
      undefined as never,
      {
        ...baseInput,
        regeneration: { previousItemId: '', regenerationCount: 1 },
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects a regeneration block with a negative regenerationCount', async () => {
    const result = await planVideoDetail(
      undefined as never,
      {
        ...baseInput,
        regeneration: { previousItemId: VALID_ID, regenerationCount: -1 },
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
