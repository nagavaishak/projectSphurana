import {
  beforeEach,
  createMockDatabase,
  createTestUser,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getUser } from './get-user.service.js';

describe('getUser', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should get a user successfully', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174001';
    const mockUser = createTestUser({ id: userId });

    mockDb.query.user.findFirst.mockResolvedValueOnce(mockUser);

    const result = await getUser(mockDb as never, { id: userId });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(userId);
    }
  });

  it('should return not found error for non-existent user', async () => {
    const userId = '123e4567-e89b-12d3-a456-426614174001';

    mockDb.query.user.findFirst.mockResolvedValueOnce(null);

    const result = await getUser(mockDb as never, { id: userId });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return validation error for empty id', async () => {
    const result = await getUser(mockDb as never, { id: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
