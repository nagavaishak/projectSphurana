import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { selectPhoneNumber } from './select-phone-number.service.js';

describe('selectPhoneNumber', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await selectPhoneNumber(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns affinity number when lead was previously called', async () => {
    const affinityNumber = {
      id: 'pn-1',
      number: '+353851234567',
    };

    // The select().from().innerJoin().where().orderBy().limit() chain
    // In createMockDatabase, chainable methods return `this`
    // The final method in chain needs to resolve with the data
    mockDb.limit.mockResolvedValueOnce([affinityNumber]);

    const result = await selectPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      leadId: 'lead-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        phoneNumberId: 'pn-1',
        number: '+353851234567',
      });
    }
  });

  it('falls back to round-robin when no affinity match', async () => {
    const roundRobinNumber = {
      id: 'pn-2',
      number: '+353859999999',
    };

    // First limit() call (affinity) returns empty
    mockDb.limit.mockResolvedValueOnce([]);
    // Second limit() call (round-robin) returns a result
    mockDb.limit.mockResolvedValueOnce([roundRobinNumber]);

    const result = await selectPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      leadId: 'lead-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        phoneNumberId: 'pn-2',
        number: '+353859999999',
      });
    }
    // Should update lastUsedAt
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns null when no pool numbers available (no leadId)', async () => {
    // Round-robin query returns empty
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await selectPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.limit.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await selectPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
