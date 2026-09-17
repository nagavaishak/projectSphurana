import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ErrorCodes } from '../../../shared/index.js';
import { listLeads } from './list-leads.service.js';

describe('listLeads', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // The list service issues a `SELECT count(*)` after fetching the page to
    // compute `total`. That chain terminates on `.where()`, so make it resolve
    // to a count row by default; individual tests can override the value.
    mockDb.where.mockResolvedValue([{ total: 0 }]);
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return leads list for organization', async () => {
    const mockLeads = [
      {
        id: 'lead_1',
        organizationId: 'org_123',
        firstName: 'John',
        status: 'new',
        createdAt: new Date(),
      },
      {
        id: 'lead_2',
        organizationId: 'org_123',
        firstName: 'Jane',
        status: 'contacted',
        createdAt: new Date(),
      },
    ];

    mockDb.query.lead.findMany.mockResolvedValueOnce(mockLeads);
    // total is a real COUNT(*), independent of the returned page size.
    mockDb.where.mockResolvedValue([{ total: 137 }]);

    const result = await listLeads(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].firstName).toBe('John');
      // The list must report the full match count, not just this page.
      expect(result.data.total).toBe(137);
    }
  });

  it('should return empty array when no leads exist', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('should filter by status', async () => {
    const inputWithStatus = {
      ...validInput,
      status: 'new' as const,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithStatus);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should filter by source', async () => {
    const inputWithSource = {
      ...validInput,
      source: 'facebook' as const,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithSource);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should filter by assignedToId', async () => {
    const inputWithAssignee = {
      ...validInput,
      assignedToId: 'user_123',
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithAssignee);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should filter by sequenceId', async () => {
    const inputWithSequence = {
      ...validInput,
      sequenceId: 'seq_123',
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithSequence);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should filter by tags', async () => {
    const inputWithTags = {
      ...validInput,
      tags: ['vip', 'premium'],
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithTags);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should search across name, email, and phone', async () => {
    const inputWithSearch = {
      ...validInput,
      search: 'john',
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithSearch);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  /**
   * Walk a drizzle SQL tree and collect the column names it references.
   * Asserting "findMany was called" cannot tell a right filter from a wrong
   * one — these tests check the email predicate actually reaches the query.
   */
  /**
   * Render the WHERE clause the service handed drizzle to real SQL text.
   * Asserting "findMany was called" cannot tell a correct predicate from an
   * inverted one, and walking the object graph is useless here because every
   * column is reachable from the table reference.
   */
  const whereSqlOfLastFindMany = () => {
    const where = (
      mockDb.query.lead.findMany.mock.calls.at(-1)?.[0] as { where?: SQL }
    )?.where;
    return where ? new PgDialect().sqlToQuery(where).sql : '';
  };

  it('should require a non-empty email when hasEmail is true', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    await listLeads(mockDb as never, { ...validInput, hasEmail: true });

    const clause = whereSqlOfLastFindMany();
    expect(clause).toContain('"email" is not null');
    expect(clause).not.toContain('"email" is null');
  });

  it('should require a missing email when hasEmail is false', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    await listLeads(mockDb as never, { ...validInput, hasEmail: false });

    const clause = whereSqlOfLastFindMany();
    expect(clause).toContain('"email" is null');
    expect(clause).not.toContain('"email" is not null');
  });

  it('should not constrain on email when hasEmail is omitted', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    await listLeads(mockDb as never, validInput);

    expect(whereSqlOfLastFindMany()).not.toContain('"email"');
  });

  it('should use default pagination values', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    await listLeads(mockDb as never, validInput);

    expect(mockDb.query.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        offset: 0,
      })
    );
  });

  it('should apply custom pagination', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 20,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    await listLeads(mockDb as never, inputWithPagination);

    expect(mockDb.query.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        offset: 20,
      })
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      listLeads(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
    };

    await expectResult(listLeads(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR for invalid status', async () => {
    const invalidInput = {
      ...validInput,
      status: 'invalid_status',
    };

    await expectResult(
      listLeads(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid source', async () => {
    const invalidInput = {
      ...validInput,
      source: 'invalid_source',
    };

    await expectResult(
      listLeads(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for negative limit', async () => {
    const invalidInput = {
      ...validInput,
      limit: -1,
    };

    await expectResult(listLeads(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    const invalidInput = {
      ...validInput,
      offset: -1,
    };

    await expectResult(listLeads(mockDb as never, invalidInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should filter by consent fields', async () => {
    const inputWithConsentFilter = {
      ...validInput,
      consentEmail: true,
      consentVoice: false,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await listLeads(mockDb as never, inputWithConsentFilter);

    expect(result.success).toBe(true);
    expect(mockDb.query.lead.findMany).toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.lead.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(listLeads(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
