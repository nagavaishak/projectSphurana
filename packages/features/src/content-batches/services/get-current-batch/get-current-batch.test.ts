import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getCurrentBatch } from './get-current-batch.service.js';

/**
 * Regression coverage for `getCurrentBatch`.
 *
 * Bug families pinned:
 *  - Validation gap: empty `organizationId` → VALIDATION_ERROR, and a malformed
 *    `periodMonth` (not YYYY-MM) → VALIDATION_ERROR, rather than an unhandled
 *    throw downstream.
 *  - Empty-state / no-data: when no batch exists for the org's current UTC
 *    month (the cron hasn't run yet), the service must return NOT_FOUND
 *    gracefully (get-current-batch.service.ts:62-69) so the Socials page can
 *    render its "no batch this month yet" empty state — never a 500. It must
 *    also short-circuit BEFORE hydrating items, so no batch lookup explodes on
 *    a missing id.
 */

describe('getCurrentBatch', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR for an empty organizationId', async () => {
    await expectResult(
      getCurrentBatch(mockDb as never, { organizationId: '' })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(mockDb.query.contentBatch.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a malformed periodMonth', async () => {
    await expectResult(
      getCurrentBatch(mockDb as never, {
        organizationId: 'org_1',
        periodMonth: '2026/01',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(mockDb.query.contentBatch.findFirst).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND (graceful empty state) when no batch exists for the period', async () => {
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getCurrentBatch(mockDb as never, {
        organizationId: 'org_1',
        periodMonth: '2026-02',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('2026-02');
    });

    // It must short-circuit before trying to hydrate items for a missing batch.
    expect(mockDb.query.contentBatch.findFirst).toHaveBeenCalledTimes(1);
  });

  // Batches are created on demand — owners click generate roughly weekly — so
  // "current" is the most recent batch, not the one whose period_month happens
  // to match today. A month-keyed default would 404 the batch they just made
  // once the month rolled over, and hide last month's batch while it was still
  // in review.
  it('resolves the most recent batch when periodMonth is omitted', async () => {
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getCurrentBatch(mockDb as never, { organizationId: 'org_1' })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      // No calendar month in the message — none was involved in the lookup.
      expect(error.message).toBe('No content batch yet');
    });

    const call = mockDb.query.contentBatch.findFirst.mock.calls[0][0];
    expect(call.orderBy).toBeDefined();
  });

  it('still honours an explicit periodMonth filter', async () => {
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getCurrentBatch(mockDb as never, {
        organizationId: 'org_1',
        periodMonth: '2026-03',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('2026-03');
    });
  });
});
