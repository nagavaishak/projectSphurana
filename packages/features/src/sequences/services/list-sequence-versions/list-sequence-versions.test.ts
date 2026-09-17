import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listSequenceVersions } from './list-sequence-versions.service.js';

describe('listSequenceVersions', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    sequenceId: 'seq_123',
    organizationId: 'org_123',
    limit: 20,
    offset: 0,
  };

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Test Sequence',
  };

  it('should return list of versions with user info', async () => {
    const mockVersions = [
      {
        id: 'ver_3',
        sequenceId: 'seq_123',
        version: 3,
        nodes: [],
        edges: [],
        changeType: 'updated',
        changeSummary: 'Updated config',
        createdAt: new Date(),
        createdById: 'user_123',
        userName: 'John Doe',
        userEmail: 'john@example.com',
        userImage: null,
      },
      {
        id: 'ver_2',
        sequenceId: 'seq_123',
        version: 2,
        nodes: [],
        edges: [],
        changeType: 'published',
        changeSummary: null,
        createdAt: new Date(),
        createdById: 'user_123',
        userName: 'John Doe',
        userEmail: 'john@example.com',
        userImage: null,
      },
    ];

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    // First query: versions with user info
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(mockVersions),
              }),
            }),
          }),
        }),
      }),
    });
    // Second query: total count
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([
            { id: 'ver_1' },
            { id: 'ver_2' },
            { id: 'ver_3' },
          ]),
      }),
    });

    const result = await listSequenceVersions(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.versions).toHaveLength(2);
      expect(result.data.total).toBe(3);
      expect(result.data.versions[0].createdBy.name).toBe('John Doe');
      expect(result.data.versions[0].changeType).toBe('updated');
    }
  });

  it('should return empty array when no versions exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    // First query: versions
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }),
    });
    // Second query: total count
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await listSequenceVersions(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.versions).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    const result = await listSequenceVersions(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('Sequence not found');
    }
  });

  it('should return NOT_FOUND when sequence belongs to different organization', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    const result = await listSequenceVersions(mockDb as never, {
      ...validInput,
      organizationId: 'different_org',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should support pagination', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    // First query: versions
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }),
    });
    // Second query: total count
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await listSequenceVersions(mockDb as never, {
      ...validInput,
      limit: 5,
      offset: 10,
    });

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing sequenceId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    const result = await listSequenceVersions(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      sequenceId: 'seq_123',
    };

    const result = await listSequenceVersions(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockRejectedValueOnce(
      new Error('Database error')
    );

    await expect(
      listSequenceVersions(mockDb as never, validInput)
    ).rejects.toThrow('Database error');
  });
});
