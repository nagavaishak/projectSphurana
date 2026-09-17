import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { redeemMembershipSession } from './redeem-membership-session.service.js';

describe('redeemMembershipSession', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    leadMembershipId: 'lm_123',
  };

  const activeMembership = {
    id: 'lm_123',
    organizationId: 'org_123',
    status: 'active',
    sessionsRemaining: 5,
    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  it('decrements a limited membership', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(
      activeMembership
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...activeMembership, sessionsRemaining: 4 },
    ]);

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionsRemaining).toBe(4);
    }
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('redeems an unlimited membership without decrementing', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...activeMembership,
      sessionsRemaining: null,
    });

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when no sessions remain (guarded decrement)', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...activeMembership,
      sessionsRemaining: 0,
    });
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('flips an out-of-date membership to expired and rejects', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...activeMembership,
      validUntil: new Date(Date.now() - 1000),
    });

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired' })
    );
  });

  it('rejects a non-active membership', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...activeMembership,
      status: 'cancelled',
    });

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns NOT_FOUND when the membership does not exist', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.leadMembership.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await redeemMembershipSession(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
