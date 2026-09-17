import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { clockOut } from './clock-out.service.js';

describe('clockOut', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    timeEntryId: 'te_1',
  };

  const openEntry = {
    id: 'te_1',
    organizationId: 'org_123',
    practitionerId: 'prac_123',
    clockIn: new Date('2026-07-06T09:00:00Z'),
    clockOut: null,
    status: 'open',
  };

  it('closes the entry and marks it completed', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    const at = new Date('2026-07-06T17:00:00Z');
    const closed = { ...openEntry, clockOut: at, status: 'completed' };
    mockDb.returning.mockResolvedValueOnce([closed]);

    const result = await clockOut(mockDb as never, { ...validInput, at });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(closed);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ breakEnd: at })
    );
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ clockOut: at, status: 'completed' })
    );
  });

  it('inserts source=auto breaks from unpaid blocked time when automatedBreaks is on', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    const at = new Date('2026-07-06T17:00:00Z');
    // where calls: #1 end-open-breaks (chainable), #2 entry update (chainable),
    // #3-5 listBlockedTime series/joins/exceptions (terminal).
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([
        {
          id: 'bt_1',
          organizationId: 'org_123',
          blockedTimeTypeId: null,
          title: 'Lunch',
          description: null,
          startDate: new Date('2026-07-06T12:00:00Z'),
          endDate: new Date('2026-07-06T12:30:00Z'),
          allDay: false,
          timezone: 'UTC',
          rrule: null,
          recurrenceEndDate: null,
          paid: false,
          createdById: 'user_1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([
      { ...openEntry, clockOut: at, status: 'completed' },
    ]);
    // Practitioner has automatedBreaks enabled; org defaults absent (→ false).
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce({
      autoClockIn: 'disabled',
      autoClockOut: 'disabled',
      automatedBreaks: 'enabled',
    });
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce(null);

    const result = await clockOut(mockDb as never, { ...validInput, at });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({
        timeEntryId: 'te_1',
        breakStart: new Date('2026-07-06T12:00:00Z'),
        breakEnd: new Date('2026-07-06T12:30:00Z'),
        source: 'auto',
      }),
    ]);
  });

  it('returns VALIDATION_ERROR for missing timeEntryId', async () => {
    const result = await clockOut(mockDb as never, {
      organizationId: 'org_123',
      timeEntryId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when entry does not exist', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);

    const result = await clockOut(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE when already clocked out', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...openEntry,
      clockOut: new Date('2026-07-06T17:00:00Z'),
    });

    const result = await clockOut(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns VALIDATION_ERROR when clock-out is before clock-in', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);

    const result = await clockOut(mockDb as never, {
      ...validInput,
      at: new Date('2026-07-06T08:00:00Z'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when clock-out is far in the future', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);

    const result = await clockOut(mockDb as never, {
      ...validInput,
      at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour ahead
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('forbids clocking out another practitioner for a non-manager caller', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
    });

    const result = await clockOut(mockDb as never, {
      ...validInput,
      requestingUserId: 'user_someone_else',
      canManageOthers: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('allows a non-manager to clock out their own linked practitioner', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      userId: 'user_self',
    });
    const at = new Date('2026-07-06T17:00:00Z');
    mockDb.returning.mockResolvedValueOnce([
      { ...openEntry, clockOut: at, status: 'completed' },
    ]);
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(null);
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce(null);

    const result = await clockOut(mockDb as never, {
      ...validInput,
      at,
      requestingUserId: 'user_self',
      canManageOthers: false,
    });

    expect(result.success).toBe(true);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.timeEntry.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await clockOut(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
