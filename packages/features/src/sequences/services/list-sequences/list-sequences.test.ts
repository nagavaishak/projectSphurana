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
import { listSequences } from './list-sequences.service.js';

describe('listSequences', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of sequences', async () => {
    const mockSequences = [
      {
        id: 'seq_1',
        organizationId: 'org_123',
        name: 'Welcome Sequence',
        isActive: true,
        createdAt: new Date(),
      },
      {
        id: 'seq_2',
        organizationId: 'org_123',
        name: 'Follow-up Sequence',
        isActive: false,
        createdAt: new Date(),
      },
    ];

    mockDb.query.sequence.findMany.mockResolvedValueOnce(mockSequences);

    const result = await listSequences(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].name).toBe('Welcome Sequence');
    }
  });

  it('should return empty array when no sequences exist', async () => {
    mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

    const result = await listSequences(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('should filter by isActive status', async () => {
    const inputWithFilter = {
      ...validInput,
      isActive: true,
    };

    const mockActiveSequences = [
      {
        id: 'seq_1',
        organizationId: 'org_123',
        name: 'Active Sequence',
        isActive: true,
        createdAt: new Date(),
      },
    ];

    mockDb.query.sequence.findMany.mockResolvedValueOnce(mockActiveSequences);

    const result = await listSequences(mockDb as never, inputWithFilter);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].isActive).toBe(true);
    }
  });

  it('should support pagination with limit and offset', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 5,
    };

    mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

    const result = await listSequences(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      listSequences(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = { organizationId: '' };

    await expectResult(
      listSequences(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findMany.mockRejectedValueOnce(
      new Error('Database error')
    );

    await expect(listSequences(mockDb as never, validInput)).rejects.toThrow(
      'Database error'
    );
  });
});
