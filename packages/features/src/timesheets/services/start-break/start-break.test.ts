import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { startBreak } from './start-break.service.js';

describe('startBreak', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', timeEntryId: 'te_1' };

  const openEntry = {
    id: 'te_1',
    organizationId: 'org_123',
    clockIn: new Date('2026-07-06T09:00:00Z'),
    clockOut: null,
    breaks: [],
  };

  it('starts a break on an open entry', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    const created = {
      id: 'br_1',
      timeEntryId: 'te_1',
      breakStart: new Date('2026-07-06T12:00:00Z'),
      breakEnd: null,
      source: 'manual',
    };
    mockDb.returning.mockResolvedValueOnce([created]);

    const result = await startBreak(mockDb as never, {
      ...validInput,
      at: new Date('2026-07-06T12:00:00Z'),
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.breaks).toEqual([created]);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    const result = await startBreak(mockDb as never, {
      organizationId: '',
      timeEntryId: 'te_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when entry does not exist', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);

    const result = await startBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE when entry is clocked out', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...openEntry,
      clockOut: new Date('2026-07-06T17:00:00Z'),
    });

    const result = await startBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns CONFLICT when a break is already in progress', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...openEntry,
      breaks: [
        {
          id: 'br_open',
          breakStart: new Date('2026-07-06T11:00:00Z'),
          breakEnd: null,
        },
      ],
    });

    const result = await startBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when break starts before clock-in', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);

    const result = await startBreak(mockDb as never, {
      ...validInput,
      at: new Date('2026-07-06T08:00:00Z'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for a break-start time in the future', async () => {
    const result = await startBreak(mockDb as never, {
      ...validInput,
      at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour ahead
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await startBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
