import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { updateTimeEntry } from './update-time-entry.service.js';

describe('updateTimeEntry', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', timeEntryId: 'te_1' };

  const completedEntry = {
    id: 'te_1',
    organizationId: 'org_123',
    clockIn: new Date('2026-07-06T09:00:00Z'),
    clockOut: new Date('2026-07-06T17:00:00Z'),
    status: 'completed',
  };

  it('updates clock times and keeps entry completed', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(completedEntry);
    const newClockOut = new Date('2026-07-06T18:00:00Z');
    mockDb.returning.mockResolvedValueOnce([
      { ...completedEntry, clockOut: newClockOut },
    ]);

    const result = await updateTimeEntry(mockDb as never, {
      ...validInput,
      clockOut: newClockOut,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ clockOut: newClockOut, status: 'completed' })
    );
  });

  it('re-opens the entry when clockOut is cleared', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(completedEntry);
    mockDb.returning.mockResolvedValueOnce([
      { ...completedEntry, clockOut: null, status: 'open' },
    ]);

    const result = await updateTimeEntry(mockDb as never, {
      ...validInput,
      clockOut: null,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ clockOut: null, status: 'open' })
    );
  });

  it('blocks re-opening when the practitioner already has another open entry', async () => {
    // #1 findFirst → the entry being edited; #2 findFirst → the re-open guard
    // finds a different already-open entry for the same practitioner.
    mockDb.query.timeEntry.findFirst
      .mockResolvedValueOnce({ ...completedEntry, practitionerId: 'prac_1' })
      .mockResolvedValueOnce({ id: 'te_other', clockOut: null });

    const result = await updateTimeEntry(mockDb as never, {
      ...validInput,
      clockOut: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    const result = await updateTimeEntry(mockDb as never, {
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

    const result = await updateTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for approved entries', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...completedEntry,
      status: 'approved',
    });

    const result = await updateTimeEntry(mockDb as never, {
      ...validInput,
      clockIn: new Date('2026-07-06T10:00:00Z'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when edited clockOut precedes clockIn', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(completedEntry);

    const result = await updateTimeEntry(mockDb as never, {
      ...validInput,
      clockIn: new Date('2026-07-06T18:00:00Z'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.timeEntry.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await updateTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
