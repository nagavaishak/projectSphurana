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
import { listNotifications } from './list-notifications.service.js';

describe('listNotifications', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
  };

  /** Re-establish the select().from().where() chain after clearAllMocks. */
  const stubCountQuery = (total: number) => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total }]);
  };

  it('should return notifications with total count', async () => {
    const mockNotifications = [
      {
        id: 'notif_1',
        organizationId: 'org_123',
        userId: 'user_123',
        type: 'appointment_booked',
        title: 'New booking',
        body: 'You have a new booking',
        linkPath: null,
        data: null,
        readAt: null,
        createdAt: new Date(),
      },
      {
        id: 'notif_2',
        organizationId: 'org_123',
        userId: 'user_123',
        type: 'appointment_cancelled',
        title: 'Booking cancelled',
        body: 'A booking was cancelled',
        linkPath: null,
        data: null,
        readAt: new Date(),
        createdAt: new Date(),
      },
    ];

    mockDb.query.notification.findMany.mockResolvedValueOnce(mockNotifications);
    stubCountQuery(2);

    const result = await listNotifications(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.items[0].id).toBe('notif_1');
    }
  });

  it('should return empty list when user has no notifications', async () => {
    mockDb.query.notification.findMany.mockResolvedValueOnce([]);
    stubCountQuery(0);

    const result = await listNotifications(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should apply default limit and offset', async () => {
    mockDb.query.notification.findMany.mockResolvedValueOnce([]);
    stubCountQuery(0);

    await listNotifications(mockDb as never, validInput);

    expect(mockDb.query.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 })
    );
  });

  it('should cap limit at 50', async () => {
    await expectResult(
      listNotifications(mockDb as never, {
        userId: 'user_123',
        limit: 100,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.notification.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      listNotifications(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.notification.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty userId', async () => {
    await expectResult(
      listNotifications(mockDb as never, { userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.notification.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    await expectResult(
      listNotifications(mockDb as never, { userId: 'user_123', offset: -1 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should propagate database errors', async () => {
    mockDb.query.notification.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      listNotifications(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
