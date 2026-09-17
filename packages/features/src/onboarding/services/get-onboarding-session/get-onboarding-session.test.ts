import { drizzleUniqueViolation } from '@borradh-workspace/database';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getOnboardingSession } from './get-onboarding-session.service.js';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: { onboardingSession: { findFirst: vi.fn() } },
};

describe('getOnboardingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
  });

  const existingSession = {
    id: 'sess_1',
    userId: 'user_1',
    status: 'active',
    currentSlide: 'website',
  };

  it('returns the existing session', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(
      existingSession
    );

    const result = await getOnboardingSession(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('sess_1');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates the session on first touch', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([existingSession]);

    const result = await getOnboardingSession(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('resolves a concurrent-create race by re-reading', async () => {
    mockDb.query.onboardingSession.findFirst
      .mockResolvedValueOnce(undefined) // initial read
      .mockResolvedValueOnce(existingSession); // re-read after unique violation
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('uniq_onboarding_session_user')
    );

    const result = await getOnboardingSession(mockDb as never, {
      userId: 'user_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('sess_1');
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const result = await getOnboardingSession(mockDb as never, {
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
