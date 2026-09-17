import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { approveTimeEntry } from './approve-time-entry.service.js';

describe('approveTimeEntry', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', timeEntryId: 'te_1' };

  const completedEntry = {
    id: 'te_1',
    organizationId: 'org_123',
    status: 'completed',
  };

  it('approves a completed entry', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(completedEntry);
    const approved = { ...completedEntry, status: 'approved' };
    mockDb.returning.mockResolvedValueOnce([approved]);

    const result = await approveTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('approved');
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'approved' });
  });

  it('is idempotent for already-approved entries', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...completedEntry,
      status: 'approved',
    });

    const result = await approveTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE for open entries', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce({
      ...completedEntry,
      status: 'open',
    });

    const result = await approveTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    const result = await approveTimeEntry(mockDb as never, {
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

    const result = await approveTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.timeEntry.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await approveTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
