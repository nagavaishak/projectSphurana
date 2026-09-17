import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { disconnectCalendarAccount } from './disconnect-calendar-account.service.js';

describe('disconnectCalendarAccount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'cal_123',
  };

  it('should disconnect calendar account successfully', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'cal_123',
      organizationId: 'org_123',
      email: 'user@gmail.com',
    });
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectCalendarAccount(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when account does not exist', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      disconnectCalendarAccount(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Calendar account not found');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      accountId: 'cal_123',
    };

    await expectResult(
      disconnectCalendarAccount(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing accountId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      disconnectCalendarAccount(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'cal_123',
      organizationId: 'org_123',
    });
    mockDb.delete.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      disconnectCalendarAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
