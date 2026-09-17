import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { restoreLeadHolds } from './restore-lead-holds.service.js';

describe('restoreLeadHolds', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const priorExpiry = new Date('2026-06-15T12:00:00.000Z');

  it('puts a released hold back with its original clock', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'apt-1' }]);

    await expectResult(
      restoreLeadHolds(mockDb as never, {
        organizationId: 'org-1',
        holds: [{ id: 'apt-1', holdExpiresAt: priorExpiry }],
      })
    ).toSucceedWith((data) => {
      expect(data.restoredCount).toBe(1);
    });

    // The ORIGINAL clock, not a fresh window — re-deriving it would silently
    // extend the reservation past what the customer was told.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'held', holdExpiresAt: priorExpiry })
    );
  });

  it('counts nothing when the row has moved on', async () => {
    // The status = 'cancelled' predicate matched no row: somebody else took
    // the slot, or an operator rebooked it. Never yank it back out from
    // under them.
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      restoreLeadHolds(mockDb as never, {
        organizationId: 'org-1',
        holds: [{ id: 'apt-1', holdExpiresAt: priorExpiry }],
      })
    ).toSucceedWith((data) => {
      expect(data.restoredCount).toBe(0);
    });
  });

  it('keeps going when one restore throws', async () => {
    mockDb.returning
      .mockRejectedValueOnce(new Error('slot taken'))
      .mockResolvedValueOnce([{ id: 'apt-2' }]);

    await expectResult(
      restoreLeadHolds(mockDb as never, {
        organizationId: 'org-1',
        holds: [
          { id: 'apt-1', holdExpiresAt: priorExpiry },
          { id: 'apt-2', holdExpiresAt: null },
        ],
      })
    ).toSucceedWith((data) => {
      expect(data.restoredCount).toBe(1);
    });
  });

  it('is a no-op for an empty list', async () => {
    await expectResult(
      restoreLeadHolds(mockDb as never, {
        organizationId: 'org-1',
        holds: [],
      })
    ).toSucceedWith((data) => {
      expect(data.restoredCount).toBe(0);
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR without an organization', async () => {
    const result = await restoreLeadHolds(mockDb as never, {
      organizationId: '',
      holds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
