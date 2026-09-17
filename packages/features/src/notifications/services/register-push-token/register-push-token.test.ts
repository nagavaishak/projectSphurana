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
import { registerPushToken } from './register-push-token.service.js';

describe('registerPushToken', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
    token: 'ExponentPushToken[abc123]',
    platform: 'ios' as const,
  };

  const mockToken = {
    id: 'token_123',
    userId: 'user_123',
    token: 'ExponentPushToken[abc123]',
    platform: 'ios',
  };

  it('should insert new token when it does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([mockToken]);

    await expectResult(
      registerPushToken(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.token).toBe('ExponentPushToken[abc123]');
      expect(data.userId).toBe('user_123');
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  // Registration is a single atomic upsert, so an already-registered token
  // takes the same code path as a new one — the conflict is handled by the
  // database rather than by a preceding read.
  it('should upsert rather than read-then-update when the token already exists', async () => {
    mockDb.returning.mockResolvedValueOnce([mockToken]);

    await expectResult(
      registerPushToken(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.userId).toBe('user_123');
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    // No pre-read and no standalone UPDATE: those were the racy pattern.
    expect(mockDb.query.devicePushToken.findFirst).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      registerPushToken(
        mockDb as never,
        {
          token: 'ExponentPushToken[abc123]',
          platform: 'ios',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty token', async () => {
    await expectResult(
      registerPushToken(mockDb as never, {
        ...validInput,
        token: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid platform', async () => {
    await expectResult(
      registerPushToken(mockDb as never, {
        ...validInput,
        platform: 'windows' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    await expectResult(
      registerPushToken(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
