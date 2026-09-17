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
import { listAllOrganizations } from './list-all-organizations.service.js';

describe('listAllOrganizations', () => {
  const mockDb = createMockDatabase();

  // Add groupBy to mockDb since createMockDatabase doesn't include it
  // but the service uses .groupBy() in its query chain
  (mockDb as Record<string, unknown>).groupBy = vi.fn().mockReturnValue(mockDb);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Re-establish groupBy chainability after reset
    (mockDb as Record<string, unknown>).groupBy = vi
      .fn()
      .mockReturnValue(mockDb);
  });

  const validInput = {};

  const mockOrganizations = [
    {
      id: 'org_1',
      name: 'Salon A',
      slug: 'salon-a',
      businessType: 'salon',
      memberCount: 3,
      createdAt: new Date(),
    },
    {
      id: 'org_2',
      name: 'Clinic B',
      slug: 'clinic-b',
      businessType: 'clinic',
      memberCount: 1,
      createdAt: new Date(),
    },
  ];

  /**
   * Helper to set up mocks for both the count query and items query.
   * The count query chain ends at .where() (1st call),
   * the items query chain ends at .offset() via .where -> .groupBy -> ... -> .offset.
   */
  function setupQueryMocks(total: number, items: unknown[]) {
    // 1st .where() call: count query terminal - resolves to [{total}]
    // 2nd .where() call: items query intermediate - falls back to mockReturnThis
    mockDb.where.mockResolvedValueOnce([{ total }]);
    mockDb.offset.mockResolvedValueOnce(items);
  }

  it('should return list of organizations with member counts', async () => {
    setupQueryMocks(2, mockOrganizations);

    const result = await listAllOrganizations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.items[0].name).toBe('Salon A');
      expect(result.data.items[0].memberCount).toBe(3);
      expect(result.data.items[1].name).toBe('Clinic B');
    }
  });

  it('should return empty list when no organizations exist', async () => {
    setupQueryMocks(0, []);

    const result = await listAllOrganizations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should use default pagination values', async () => {
    setupQueryMocks(0, []);

    const result = await listAllOrganizations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should apply custom pagination', async () => {
    const inputWithPagination = {
      limit: 10,
      offset: 20,
    };

    setupQueryMocks(50, []);

    const result = await listAllOrganizations(
      mockDb as never,
      inputWithPagination
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
    expect(mockDb.limit).toHaveBeenCalledWith(10);
    expect(mockDb.offset).toHaveBeenCalledWith(20);
  });

  it('should accept search parameter', async () => {
    const inputWithSearch = {
      search: 'salon',
    };

    setupQueryMocks(1, [mockOrganizations[0]]);

    const result = await listAllOrganizations(mockDb as never, inputWithSearch);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.total).toBe(1);
    }
  });

  it('should return VALIDATION_ERROR for limit below minimum', async () => {
    const invalidInput = { limit: 0 };

    await expectResult(
      listAllOrganizations(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for limit above maximum', async () => {
    const invalidInput = { limit: 101 };

    await expectResult(
      listAllOrganizations(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    const invalidInput = { offset: -1 };

    await expectResult(
      listAllOrganizations(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should handle count result being undefined', async () => {
    mockDb.where.mockResolvedValueOnce([undefined]);
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listAllOrganizations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(0);
    }
  });

  it('should handle database errors gracefully', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('Database connection failed'));

    await expect(
      listAllOrganizations(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
