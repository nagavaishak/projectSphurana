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
import { getUnreadNotificationCount } from './get-unread-notification-count.service.js';

describe('getUnreadNotificationCount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
  };

  /** Re-establish the select().from().where() chain after clearAllMocks. */
  const stubCountQuery = (unreadCount: number) => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ unreadCount }]);
  };

  it('should return the unread count', async () => {
    stubCountQuery(5);

    const result = await getUnreadNotificationCount(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(5);
    }
  });

  it('should return zero when there are no unread notifications', async () => {
    stubCountQuery(0);

    const result = await getUnreadNotificationCount(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      getUnreadNotificationCount(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    await expectResult(
      getUnreadNotificationCount(mockDb as never, { userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should propagate database errors', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Database connection failed'));

    await expect(
      getUnreadNotificationCount(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
