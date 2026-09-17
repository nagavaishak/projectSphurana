import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { checkAdminAccess } from './check-admin-access.service.js';

describe('checkAdminAccess', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
    organizationId: 'org_123',
  };

  it('should return hasAccess=true when user is owner', async () => {
    // db.select().from().where().limit() chain - limit is the terminal method
    mockDb.limit.mockResolvedValueOnce([{ role: 'owner' }]);

    const result = await checkAdminAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasAccess).toBe(true);
      expect(result.data.role).toBe('owner');
    }
  });

  it('should return hasAccess=true when user is admin', async () => {
    mockDb.limit.mockResolvedValueOnce([{ role: 'admin' }]);

    const result = await checkAdminAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasAccess).toBe(true);
      expect(result.data.role).toBe('admin');
    }
  });

  it('should return hasAccess=false when user is regular member', async () => {
    mockDb.limit.mockResolvedValueOnce([{ role: 'member' }]);

    const result = await checkAdminAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasAccess).toBe(false);
      expect(result.data.role).toBe('member');
    }
  });

  it('should return hasAccess=false with role=null when user is not a member', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await checkAdminAccess(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasAccess).toBe(false);
      expect(result.data.role).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      checkAdminAccess(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      userId: 'user_123',
    };

    await expectResult(
      checkAdminAccess(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    const invalidInput = {
      userId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      checkAdminAccess(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      userId: 'user_123',
      organizationId: '',
    };

    await expectResult(
      checkAdminAccess(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.limit.mockRejectedValueOnce(new Error('Database connection failed'));

    await expect(checkAdminAccess(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
