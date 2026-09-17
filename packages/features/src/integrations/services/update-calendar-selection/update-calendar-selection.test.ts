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
import { updateCalendarSelection } from './update-calendar-selection.service.js';

describe('updateCalendarSelection', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'acc_123',
    calendarId: 'cal_primary',
  };

  it('should update calendar selection successfully', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'acc_123',
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { id: 'acc_123', calendarId: 'cal_primary' },
    ]);

    const result = await updateCalendarSelection(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.calendarId).toBe('cal_primary');
    }
  });

  it('should return NOT_FOUND when account not found', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateCalendarSelection(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty calendarId', async () => {
    await expectResult(
      updateCalendarSelection(mockDb as never, {
        ...validInput,
        calendarId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty accountId', async () => {
    await expectResult(
      updateCalendarSelection(mockDb as never, { ...validInput, accountId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'acc_123',
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      updateCalendarSelection(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
