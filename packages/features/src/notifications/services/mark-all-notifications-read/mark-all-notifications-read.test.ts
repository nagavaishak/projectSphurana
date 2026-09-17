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
import { markAllNotificationsRead } from './mark-all-notifications-read.service.js';

describe('markAllNotificationsRead', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Re-establish the update().set().where().returning() chain.
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  const validInput = {
    userId: 'user_123',
  };

  it('should mark all unread notifications as read and return the count', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'notif_1' },
      { id: 'notif_2' },
      { id: 'notif_3' },
    ]);

    const result = await markAllNotificationsRead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(3);
    }
  });

  it('should return zero when there are no unread notifications', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await markAllNotificationsRead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      markAllNotificationsRead(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    await expectResult(
      markAllNotificationsRead(mockDb as never, { userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should propagate database errors', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      markAllNotificationsRead(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
