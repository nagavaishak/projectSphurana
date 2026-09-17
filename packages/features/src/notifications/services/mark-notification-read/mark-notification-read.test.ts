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
import { markNotificationRead } from './mark-notification-read.service.js';

describe('markNotificationRead', () => {
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
    id: 'notif_123',
    userId: 'user_123',
  };

  it('should mark the notification as read and return the updated row', async () => {
    const readAt = new Date();
    const mockNotification = {
      id: 'notif_123',
      organizationId: 'org_123',
      userId: 'user_123',
      type: 'appointment_booked',
      title: 'New booking',
      body: 'You have a new booking',
      linkPath: null,
      data: null,
      readAt,
      createdAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockNotification]);

    const result = await markNotificationRead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('notif_123');
      expect(result.data.readAt).toBe(readAt);
    }
  });

  it('should be idempotent when the notification is already read', async () => {
    const mockNotification = {
      id: 'notif_123',
      organizationId: 'org_123',
      userId: 'user_123',
      type: 'appointment_booked',
      title: 'New booking',
      body: 'You have a new booking',
      linkPath: null,
      data: null,
      readAt: new Date(),
      createdAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockNotification]);

    const result = await markNotificationRead(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('should return NOT_FOUND when no row is updated', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      markNotificationRead(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain(validInput.id);
    });
  });

  it('should return NOT_FOUND when the notification belongs to another user', async () => {
    // Ownership check excludes the row, so the update returns nothing
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      markNotificationRead(mockDb as never, {
        id: 'notif_123',
        userId: 'other_user',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      markNotificationRead(
        mockDb as never,
        {
          userId: 'user_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      markNotificationRead(
        mockDb as never,
        {
          id: 'notif_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    await expectResult(
      markNotificationRead(mockDb as never, { id: '', userId: 'user_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should propagate database errors', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      markNotificationRead(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
