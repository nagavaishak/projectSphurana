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
import { restoreSequenceVersion } from './restore-sequence-version.service.js';

describe('restoreSequenceVersion', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    sequenceId: 'seq_123',
    versionId: 'ver_2',
    organizationId: 'org_123',
    userId: 'user_123',
  };

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Test Sequence',
    nodes: [{ id: 'current', type: 'sms' }],
    edges: [],
  };

  const versionToRestore = {
    id: 'ver_2',
    sequenceId: 'seq_123',
    version: 2,
    nodes: [{ id: 'restored', type: 'voice_call' }],
    edges: [{ source: 'a', target: 'b' }],
    changeType: 'updated',
  };

  it('should restore sequence from a previous version', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.sequenceVersion.findFirst.mockResolvedValueOnce(
      versionToRestore
    );
    // Update sequence
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        ...existingSequence,
        nodes: versionToRestore.nodes,
        edges: versionToRestore.edges,
      },
    ]);
    // Get latest version for new version entry
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ version: 3 }]);
    // Insert new version entry
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);

    const result = await restoreSequenceVersion(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toEqual(versionToRestore.nodes);
      expect(result.data.edges).toEqual(versionToRestore.edges);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should create version entry with restored changeType', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.sequenceVersion.findFirst.mockResolvedValueOnce(
      versionToRestore
    );
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([existingSequence]);
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);

    await restoreSequenceVersion(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'restored',
        changeSummary: `Restored from version ${versionToRestore.version}`,
      })
    );
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      restoreSequenceVersion(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Sequence not found');
    });
  });

  it('should return NOT_FOUND when version does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.sequenceVersion.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      restoreSequenceVersion(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Version not found');
    });
  });

  it('should return NOT_FOUND when version belongs to different sequence', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.sequenceVersion.findFirst.mockResolvedValueOnce(null);

    const result = await restoreSequenceVersion(mockDb as never, {
      ...validInput,
      versionId: 'ver_from_other_seq',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing sequenceId', async () => {
    const invalidInput = {
      versionId: 'ver_2',
      organizationId: 'org_123',
      userId: 'user_123',
    };

    await expectResult(
      restoreSequenceVersion(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing versionId', async () => {
    const invalidInput = {
      sequenceId: 'seq_123',
      organizationId: 'org_123',
      userId: 'user_123',
    };

    await expectResult(
      restoreSequenceVersion(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      sequenceId: 'seq_123',
      versionId: 'ver_2',
      userId: 'user_123',
    };

    await expectResult(
      restoreSequenceVersion(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.sequenceVersion.findFirst.mockResolvedValueOnce(
      versionToRestore
    );
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expect(
      restoreSequenceVersion(mockDb as never, validInput)
    ).rejects.toThrow('Database error');
  });
});
