import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listTimeEntries } from './list-time-entries.service.js';

describe('listTimeEntries', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns entries with breaks', async () => {
    const entries = [
      { id: 'te_1', breaks: [] },
      { id: 'te_2', breaks: [{ id: 'br_1' }] },
    ];
    mockDb.query.timeEntry.findMany.mockResolvedValueOnce(entries);

    const result = await listTimeEntries(mockDb as never, {
      organizationId: 'org_123',
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-07T00:00:00Z',
      practitionerId: 'prac_123',
      status: 'completed',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entries);
    expect(mockDb.query.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ with: { breaks: true } })
    );
  });

  it('returns VALIDATION_ERROR for invalid status', async () => {
    const result = await listTimeEntries(mockDb as never, {
      organizationId: 'org_123',
      // @ts-expect-error invalid status on purpose
      status: 'nope',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listTimeEntries(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.timeEntry.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await listTimeEntries(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
