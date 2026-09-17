import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listAutoClockCandidates } from './list-auto-clock-candidates.service.js';

describe('listAutoClockCandidates', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => vi.clearAllMocks());

  it('returns the rows the filtered query yields', async () => {
    const rows = [
      { organizationId: 'org_1', practitionerId: 'prac_1' },
      { organizationId: 'org_2', practitionerId: 'prac_2' },
    ];
    mockDb.orderBy.mockResolvedValueOnce(rows);

    const result = await listAutoClockCandidates(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(rows);
  });

  it('selects DISTINCT so a duplicate wage-config row cannot double-tick a practitioner', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    await listAutoClockCandidates(mockDb as never);

    expect(mockDb.selectDistinct).toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns an empty list when no practitioner has auto-clock enabled', async () => {
    // The prod shape today: auto-clock off everywhere, so the tick has
    // nothing to fan out over and costs exactly this one query.
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listAutoClockCandidates(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('retries a transient pooled-connection failure before returning candidates', async () => {
    const transientError = Object.assign(new Error('connection closed'), {
      code: 'CONNECTION_CLOSED',
    });
    const rows = [{ organizationId: 'org_1', practitionerId: 'prac_1' }];
    mockDb.orderBy
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(rows);

    const result = await listAutoClockCandidates(mockDb as never);

    expect(result).toEqual({ success: true, data: rows });
    expect(mockDb.orderBy).toHaveBeenCalledTimes(2);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    const databaseError = new Error('DB failed');
    mockDb.orderBy.mockRejectedValueOnce(databaseError);

    const result = await listAutoClockCandidates(mockDb as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.cause).toBe(databaseError);
    }
  });
});
