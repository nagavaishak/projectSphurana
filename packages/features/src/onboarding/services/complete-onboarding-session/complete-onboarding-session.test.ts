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
import { completeOnboardingSession } from './complete-onboarding-session.service.js';

const mockDb = createMockDatabase();

describe('completeOnboardingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('marks the session completed', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sess-1', userId: 'user-1', status: 'completed' },
    ]);

    const result = await completeOnboardingSession(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('returns NOT_FOUND when no session exists for the user', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      completeOnboardingSession(mockDb as never, { userId: 'user-1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a missing userId', async () => {
    await expectResult(
      completeOnboardingSession(mockDb as never, { userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
