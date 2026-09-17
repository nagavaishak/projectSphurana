import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { clearSessionSecondaryStorageForUser } from './clear-session-secondary-storage-for-user.service.js';

const userId = '00000000-0000-4000-8000-000000000001';

const baseUser = {
  id: userId,
  name: 'Updated Name',
  email: 'u@example.com',
  emailVerified: true,
  image: null,
  currency: 'USD',
  timezone: 'UTC',
  role: 'user' as const,
  banned: false,
  banReason: null,
  banExpires: null,
  twoFactorEnabled: false,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2024-06-01'),
};

describe('clearSessionSecondaryStorageForUser', () => {
  const mockDb = createMockDatabase();
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    ttl: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockRedis.get.mockReset();
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockRedis.ttl.mockReset();
    mockRedis.del.mockReset().mockResolvedValue(1);
  });

  it('should merge fresh user into Redis session blob keyed by raw token', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(baseUser);
    mockDb.where.mockResolvedValueOnce([{ token: 'tok-abc' }]);
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === `active-sessions-${userId}`) return null;
      if (key === 'tok-abc') {
        return JSON.stringify({
          session: {
            id: 'sess-1',
            userId,
            token: 'tok-abc',
            expiresAt: new Date('2030-01-01').toISOString(),
          },
          user: { ...baseUser, name: 'Old Name' },
        });
      }
      return null;
    });
    mockRedis.ttl.mockResolvedValueOnce(3600);

    const result = await clearSessionSecondaryStorageForUser(
      mockDb as never,
      { userId },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshedCount).toBe(1);
    }
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const setArgs = mockRedis.set.mock.calls[0];
    expect(setArgs[0]).toBe('tok-abc');
    expect(setArgs[2]).toBe('EX');
    expect(setArgs[3]).toBe(3600);
    const written = JSON.parse(setArgs[1] as string) as {
      user: { name: string };
    };
    expect(written.user.name).toBe('Updated Name');
  });

  it('should collect tokens from active-sessions when DB has none', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(baseUser);
    mockDb.where.mockResolvedValueOnce([]);
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === `active-sessions-${userId}`) {
        return JSON.stringify([
          { token: 'from-list', expiresAt: Date.now() + 60_000 },
        ]);
      }
      if (key === 'from-list') {
        return JSON.stringify({
          session: { id: 's', userId, token: 'from-list' },
          user: { ...baseUser, name: 'Old' },
        });
      }
      return null;
    });
    mockRedis.ttl.mockResolvedValue(-1);

    const result = await clearSessionSecondaryStorageForUser(
      mockDb as never,
      { userId },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshedCount).toBe(1);
    }
    expect(mockRedis.set).toHaveBeenCalledWith(
      'from-list',
      expect.stringContaining('"name":"Updated Name"')
    );
  });

  it('should return refreshedCount 0 without Redis', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(baseUser);

    const result = await clearSessionSecondaryStorageForUser(mockDb as never, {
      userId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshedCount).toBe(0);
    }
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    const result = await clearSessionSecondaryStorageForUser(mockDb as never, {
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should still succeed when one token refresh throws', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(baseUser);
    mockDb.where.mockResolvedValueOnce([{ token: 'bad' }, { token: 'good' }]);
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === `active-sessions-${userId}`) return null;
      if (key === 'bad') throw new Error('redis read fail');
      if (key === 'good') {
        return JSON.stringify({
          session: { id: 's', userId },
          user: baseUser,
        });
      }
      return null;
    });
    mockRedis.ttl.mockResolvedValue(100);

    const result = await clearSessionSecondaryStorageForUser(
      mockDb as never,
      { userId },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refreshedCount).toBe(1);
    }
  });
});
