import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { clearActiveOrgSessions } from './clear-active-org-sessions.service.js';

describe('clearActiveOrgSessions', () => {
  const mockDb = createMockDatabase();
  const mockRedis = { del: vi.fn().mockResolvedValue(1) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockRedis.del.mockReset().mockResolvedValue(1);
  });

  it('should clear sessions and Redis cache for a user+org pair', async () => {
    const input = {
      userId: 'user-123',
      organizationId: 'org-456',
    };

    // Mock: select affected sessions (returns tokens)
    mockDb.where.mockResolvedValueOnce([
      { token: 'session-token-1' },
      { token: 'session-token-2' },
    ]);

    // Mock: update sessions (set activeOrganizationId to null)
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await clearActiveOrgSessions(
      mockDb as never,
      input,
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updatedCount).toBe(2);
    }
    expect(mockRedis.del).toHaveBeenCalledWith(
      'session-token-1',
      'session-token-2'
    );
  });

  it('should succeed with zero affected sessions', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await clearActiveOrgSessions(
      mockDb as never,
      { userId: 'user-123', organizationId: 'org-456' },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updatedCount).toBe(0);
    }
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('should work without Redis (optional parameter)', async () => {
    mockDb.where.mockResolvedValueOnce([{ token: 'tok' }]);
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await clearActiveOrgSessions(mockDb as never, {
      userId: 'user-123',
      organizationId: 'org-456',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updatedCount).toBe(1);
    }
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    const result = await clearActiveOrgSessions(mockDb as never, {
      userId: '',
      organizationId: 'org-456',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const result = await clearActiveOrgSessions(mockDb as never, {
      userId: 'user-123',
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return INTERNAL_ERROR on DB failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await clearActiveOrgSessions(mockDb as never, {
      userId: 'user-123',
      organizationId: 'org-456',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should still succeed when Redis cleanup fails (best-effort)', async () => {
    mockDb.where.mockResolvedValueOnce([{ token: 'tok-1' }]);
    mockDb.where.mockResolvedValueOnce(undefined);
    mockRedis.del.mockRejectedValueOnce(new Error('Redis timeout'));

    const result = await clearActiveOrgSessions(
      mockDb as never,
      { userId: 'user-123', organizationId: 'org-456' },
      mockRedis
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updatedCount).toBe(1);
    }
  });
});
