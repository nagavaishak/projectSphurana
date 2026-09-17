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
import { deactivateSequence } from './deactivate-sequence.service.js';

describe('deactivateSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'seq_123',
    organizationId: 'org_123',
  };

  const activeSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Test Sequence',
    isActive: true,
  };

  it('should deactivate an active sequence', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(activeSequence);
    mockDb.returning.mockResolvedValueOnce([
      { ...activeSequence, isActive: false },
    ]);

    const result = await deactivateSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(false);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deactivateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('seq_123');
    });
  });

  it('should return INVALID_STATE when sequence is already inactive', async () => {
    const inactiveSequence = { ...activeSequence, isActive: false };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(inactiveSequence);

    await expectResult(
      deactivateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('already inactive');
    });
  });

  it('should return NOT_FOUND when sequence belongs to different organization', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    const result = await deactivateSequence(mockDb as never, {
      id: 'seq_123',
      organizationId: 'different_org',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      deactivateSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'seq_123',
    };

    await expectResult(
      deactivateSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(activeSequence);
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expect(
      deactivateSequence(mockDb as never, validInput)
    ).rejects.toThrow('Database error');
  });
});
