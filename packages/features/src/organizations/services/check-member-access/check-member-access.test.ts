import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { checkMemberAccess } from './check-member-access.service.js';

describe('checkMemberAccess', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user-123',
    organizationId: 'org-456',
  };

  it('should return isMember true when user is a member', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ role: 'member' }]);

    const result = await checkMemberAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isMember).toBe(true);
      expect(result.data.role).toBe('member');
    }
  });

  it('should return isMember true for owner role', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ role: 'owner' }]);

    const result = await checkMemberAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isMember).toBe(true);
      expect(result.data.role).toBe('owner');
    }
  });

  it('should return isMember false when user is not a member', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await checkMemberAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isMember).toBe(false);
      expect(result.data.role).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    const result = await checkMemberAccess(mockDb as never, {
      userId: '',
      organizationId: 'org-456',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const result = await checkMemberAccess(mockDb as never, {
      userId: 'user-123',
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
