import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { invalidateUserSessions } from './invalidate-user-sessions.service.js';

describe('invalidateUserSessions', () => {
  const mockDb = createMockDatabase();
  const mockRedis = { del: vi.fn().mockResolvedValue(1) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockRedis.del.mockReset().mockResolvedValue(1);
  });

  it('should delete all sessions for a user and clean Redis', async () => {
    // Mock: select user sessions
    mockDb.where.mockResolvedValueOnce([
      { token: 'token-a' },
      { token: 'token-b' },
    ]);
    // Mock: delete sessions from DB
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await invalidateUserSessions(
      mockDb as never,
      { userId: 'user-123' },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(2);
    }
    expect(mockRedis.del).toHaveBeenCalledWith(
      'token-a',
      'token-b',
      'active-sessions-user-123'
    );
  });

  it('should succeed with zero sessions', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await invalidateUserSessions(
      mockDb as never,
      { userId: 'user-123' },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(0);
    }
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('should work without Redis', async () => {
    mockDb.where.mockResolvedValueOnce([{ token: 'tok' }]);
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await invalidateUserSessions(mockDb as never, {
      userId: 'user-123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(1);
    }
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    const result = await invalidateUserSessions(mockDb as never, {
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return INTERNAL_ERROR on DB failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    const result = await invalidateUserSessions(mockDb as never, {
      userId: 'user-123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should still succeed when Redis cleanup fails (best-effort)', async () => {
    mockDb.where.mockResolvedValueOnce([{ token: 'tok' }]);
    mockDb.where.mockResolvedValueOnce(undefined);
    mockRedis.del.mockRejectedValueOnce(new Error('Redis down'));

    const result = await invalidateUserSessions(
      mockDb as never,
      { userId: 'user-123' },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedCount).toBe(1);
    }
  });
});
