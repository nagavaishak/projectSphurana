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
import { updateSequence } from './update-sequence.service.js';

describe('updateSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Updated Sequence Name',
    userId: 'user_123',
  };

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Original Name',
    description: 'Original description',
    isActive: false,
    nodes: [],
    edges: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should update sequence name', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingSequence, name: 'Updated Sequence Name' },
    ]);

    const result = await updateSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Sequence Name');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should update multiple fields', async () => {
    const inputWithMultipleFields = {
      ...validInput,
      description: 'New description',
      triggerOnNewLead: true,
      scheduleNextDay: true,
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...existingSequence,
        name: 'Updated Sequence Name',
        description: 'New description',
        triggerOnNewLead: true,
        scheduleNextDay: true,
      },
    ]);

    const result = await updateSequence(
      mockDb as never,
      inputWithMultipleFields
    );

    expect(result.success).toBe(true);
  });

  it('should create version when nodes are updated', async () => {
    const inputWithNodes = {
      ...validInput,
      nodes: [{ id: 'node_1', type: 'sms', data: {} }],
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingSequence, nodes: inputWithNodes.nodes },
    ]);
    // Mock getting latest version
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ version: 1 }]);

    const result = await updateSequence(mockDb as never, inputWithNodes);

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled(); // Should create a version
  });

  it('should create version when edges are updated', async () => {
    const inputWithEdges = {
      ...validInput,
      edges: [{ source: 'node_1', target: 'node_2' }],
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingSequence, edges: inputWithEdges.edges },
    ]);
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]); // No previous versions

    const result = await updateSequence(mockDb as never, inputWithEdges);

    expect(result.success).toBe(true);
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(updateSequence(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain('seq_123');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      name: 'Test',
    };

    await expectResult(
      updateSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'seq_123',
      name: 'Test',
    };

    await expectResult(
      updateSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expect(updateSequence(mockDb as never, validInput)).rejects.toThrow(
      'Database error'
    );
  });
});
