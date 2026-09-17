import {
  beforeEach,
  createMockDatabase,
  describe,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { unregisterPushToken } from './unregister-push-token.service.js';

describe('unregisterPushToken', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should delete token successfully', async () => {
    mockDb.where.mockResolvedValueOnce(undefined);

    await expectResult(
      unregisterPushToken(mockDb as never, {
        token: 'ExponentPushToken[abc123]',
      })
    ).toSucceedWith((data) => {
      expect(data.success).toBe(true);
    });

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should succeed even if token does not exist', async () => {
    mockDb.where.mockResolvedValueOnce(undefined);

    await expectResult(
      unregisterPushToken(mockDb as never, { token: 'non_existent_token' })
    ).toSucceedWith((data) => {
      expect(data.success).toBe(true);
    });
  });

  it('should return VALIDATION_ERROR for empty token', async () => {
    await expectResult(
      unregisterPushToken(mockDb as never, { token: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on DB failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB connection lost'));

    await expectResult(
      unregisterPushToken(mockDb as never, {
        token: 'ExponentPushToken[abc123]',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
