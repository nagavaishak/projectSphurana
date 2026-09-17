import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { dispatchMonthlyPlan } from './dispatch-monthly-plan.service.js';

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';

const basePlan = {
  organizationId: VALID_ID,
  periodMonth: '2026-01',
  items: [
    {
      kind: 'video' as const,
      targetServiceId: 'svc-1',
      topicSummary: 'Video topic',
      rationale: 'video reason',
    },
  ],
};

const baseInput = {
  plan: basePlan,
  batchId: VALID_ID,
  createdById: VALID_ID,
  videoSchedules: [new Date('2026-01-02T10:00:00.000Z')],
  targetPageIds: [],
};

describe('dispatchMonthlyPlan validation', () => {
  it('rejects mismatched videoSchedules length', async () => {
    const result = await dispatchMonthlyPlan(
      undefined as never,
      {
        ...baseInput,
        // plan has 1 video item, but we pass 0 schedules
        videoSchedules: [],
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects empty batchId', async () => {
    const result = await dispatchMonthlyPlan(
      undefined as never,
      {
        ...baseInput,
        batchId: '',
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects empty createdById', async () => {
    const result = await dispatchMonthlyPlan(
      undefined as never,
      {
        ...baseInput,
        createdById: '',
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects bad periodMonth on the plan', async () => {
    const result = await dispatchMonthlyPlan(
      undefined as never,
      {
        ...baseInput,
        plan: { ...basePlan, periodMonth: '2026-13' },
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects plan items with invalid kind', async () => {
    const result = await dispatchMonthlyPlan(
      undefined as never,
      {
        ...baseInput,
        plan: {
          ...basePlan,
          items: [
            {
              kind: 'reel',
              targetServiceId: 'svc-1',
              topicSummary: 'topic',
              rationale: 'reason',
            },
          ],
        },
      } as never
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
