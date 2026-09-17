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
import { createSequenceVersion } from './create-sequence-version.service.js';

describe('createSequenceVersion', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    sequenceId: 'seq_123',
    organizationId: 'org_123',
    userId: 'user_123',
    nodes: [{ id: 'node_1', type: 'sms', data: {} }],
    edges: [],
    changeType: 'updated' as const,
    changeSummary: 'Updated SMS message',
  };

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Test Sequence',
  };

  it('should create first version for a sequence', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    // No existing versions
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);
    // Insert new version
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'ver_1',
        sequenceId: 'seq_123',
        version: 1,
        nodes: validInput.nodes,
        edges: validInput.edges,
        changeType: 'updated',
        changeSummary: 'Updated SMS message',
      },
    ]);

    const result = await createSequenceVersion(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.changeType).toBe('updated');
    }
  });

  it('should increment version number', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    // Existing version 3
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ version: 3 }]);
    // Insert new version
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'ver_4',
        sequenceId: 'seq_123',
        version: 4,
        nodes: validInput.nodes,
        edges: validInput.edges,
        changeType: 'updated',
      },
    ]);

    const result = await createSequenceVersion(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(4);
    }
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createSequenceVersion(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Sequence not found');
    });
  });

  it('should return NOT_FOUND when sequence belongs to different organization', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    const result = await createSequenceVersion(mockDb as never, {
      ...validInput,
      organizationId: 'different_org',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing sequenceId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      userId: 'user_123',
      nodes: [],
      edges: [],
      changeType: 'updated',
    };

    await expectResult(
      createSequenceVersion(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      sequenceId: 'seq_123',
      userId: 'user_123',
      nodes: [],
      edges: [],
      changeType: 'updated',
    };

    await expectResult(
      createSequenceVersion(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expect(
      createSequenceVersion(mockDb as never, validInput)
    ).rejects.toThrow('Database error');
  });
});
