import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as deleteOrg from '../../../organizations/services/delete-organization/delete-organization.service.js';
import { ErrorCodes, ok } from '../../../shared/index.js';
import { resetOnboardingSession } from './reset-onboarding-session.service.js';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: { onboardingSession: { findFirst: vi.fn() } },
};

// delete-organization is an internal module with its own tests — restored
// spy, not a file-local vi.mock (would leak under isolate:false).
let mockDeleteOrg: ReturnType<typeof vi.spyOn>;

describe('resetOnboardingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDeleteOrg = vi
      .spyOn(deleteOrg, 'deleteOrganization')
      .mockResolvedValue(
        ok({ success: true, deletedOrganizationId: 'org_1' }) as never
      );
  });

  const session = {
    id: 'sess_1',
    userId: 'user_1',
    organizationId: 'org_1',
    status: 'completed',
    currentSlide: 'whatsapp',
    offerId: 'offer_1',
    metaCampaignId: 'camp_1',
  };

  it('deletes the org and rewinds to the first slide (lands like a new signup)', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(session);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...session,
        status: 'active',
        currentSlide: 'intro',
        organizationId: null,
        offerId: null,
      },
    ]);

    const result = await resetOnboardingSession(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    // The flow-created org is (soft-)deleted so org count drops to zero
    expect(mockDeleteOrg).toHaveBeenCalledWith(mockDb, {
      organizationId: 'org_1',
      requesterId: 'user_1',
    });
    const setArg = mockDb.set.mock.calls[0][0];
    expect(setArg).toEqual(
      expect.objectContaining({
        status: 'active',
        currentSlide: 'intro',
        organizationId: null,
        answers: null,
        offerId: null,
        metaCampaignId: null,
        launchedAt: null,
      })
    );
  });

  it('skips org deletion when the session has no org yet', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...session,
      organizationId: null,
    });
    mockDb.returning.mockResolvedValueOnce([session]);

    const result = await resetOnboardingSession(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    expect(mockDeleteOrg).not.toHaveBeenCalled();
  });

  it('mints a fresh session when none exists (idempotent restart)', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sess_new', userId: 'user_1', currentSlide: 'intro' },
    ]);

    const result = await resetOnboardingSession(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDeleteOrg).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const result = await resetOnboardingSession(mockDb as never, {
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
