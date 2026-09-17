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
import { listExecutions } from './list-executions.service.js';

describe('listExecutions', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of executions', async () => {
    const mockExecutions = [
      {
        execution: {
          id: 'exec_1',
          sequenceId: 'seq_1',
          leadId: 'lead_1',
          status: 'completed',
          scheduledAt: new Date('2024-01-01T10:00:00Z'),
          executedAt: new Date('2024-01-01T10:05:00Z'),
          errorMessage: null,
          createdAt: new Date(),
        },
        sequence: {
          id: 'seq_1',
          name: 'Welcome Sequence',
          organizationId: 'org_123',
        },
        lead: {
          id: 'lead_1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        },
      },
    ];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce(mockExecutions);

    const result = await listExecutions(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executions).toHaveLength(1);
      expect(result.data.executions[0].leadName).toBe('John Doe');
      expect(result.data.executions[0].sequenceName).toBe('Welcome Sequence');
      expect(result.data.executions[0].status).toBe('completed');
      expect(result.data.executions[0].runTimeMs).toBe(300000); // 5 minutes
    }
  });

  it('should return empty array when no executions exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listExecutions(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executions).toHaveLength(0);
    }
  });

  it('should filter by sequenceId', async () => {
    const inputWithFilter = {
      ...validInput,
      sequenceId: 'seq_123',
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listExecutions(mockDb as never, inputWithFilter);

    expect(result.success).toBe(true);
  });

  it('should filter by status', async () => {
    const inputWithStatus = {
      ...validInput,
      status: 'pending',
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listExecutions(mockDb as never, inputWithStatus);

    expect(result.success).toBe(true);
  });

  it('should support pagination', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 5,
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce([]);

    const result = await listExecutions(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
  });

  it('should handle lead without lastName', async () => {
    const mockExecutions = [
      {
        execution: {
          id: 'exec_1',
          sequenceId: 'seq_1',
          leadId: 'lead_1',
          status: 'completed',
          scheduledAt: null,
          executedAt: null,
          errorMessage: null,
          createdAt: new Date(),
        },
        sequence: {
          id: 'seq_1',
          name: 'Sequence',
          organizationId: 'org_123',
        },
        lead: {
          id: 'lead_1',
          firstName: 'Jane',
          lastName: null,
          email: 'jane@example.com',
        },
      },
    ];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockResolvedValueOnce(mockExecutions);

    const result = await listExecutions(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executions[0].leadName).toBe('Jane');
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      listExecutions(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockRejectedValueOnce(new Error('Database error'));

    await expect(listExecutions(mockDb as never, validInput)).rejects.toThrow(
      'Database error'
    );
  });
});
