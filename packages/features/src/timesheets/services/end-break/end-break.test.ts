import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { endBreak } from './end-break.service.js';

describe('endBreak', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', timeEntryId: 'te_1' };

  const openBreak = {
    id: 'br_1',
    timeEntryId: 'te_1',
    breakStart: new Date('2026-07-06T12:00:00Z'),
    breakEnd: null,
  };

  const entryWithOpenBreak = {
    id: 'te_1',
    organizationId: 'org_123',
    clockIn: new Date('2026-07-06T09:00:00Z'),
    clockOut: null,
    breaks: [openBreak],
  };

  it('ends the break in progress', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(entryWithOpenBreak);
    const at = new Date('2026-07-06T12:30:00Z');
    const updated = { ...openBreak, breakEnd: at };
    mockDb.returning.mockResolvedValueOnce([updated]);

    const result = await endBreak(mockDb as never, { ...validInput, at });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.breaks).toEqual([updated]);
    expect(mockDb.set).toHaveBeenCalledWith({ breakEnd: at });
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    const result = await endBreak(mockDb as never, {
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

    const result = await endBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE when no break is in progress', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...entryWithOpenBreak,
      breaks: [{ ...openBreak, breakEnd: new Date('2026-07-06T12:15:00Z') }],
    });

    const result = await endBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns VALIDATION_ERROR when end is before break start', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(entryWithOpenBreak);

    const result = await endBreak(mockDb as never, {
      ...validInput,
      at: new Date('2026-07-06T11:00:00Z'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.timeEntry.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await endBreak(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
