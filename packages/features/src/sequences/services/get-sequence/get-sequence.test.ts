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
import { getSequence } from './get-sequence.service.js';

describe('getSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'seq_123',
    organizationId: 'org_123',
  };

  it('should return sequence when found', async () => {
    const mockSequence = {
      id: 'seq_123',
      organizationId: 'org_123',
      name: 'Welcome Sequence',
      description: 'Initial outreach',
      isActive: true,
      triggerOnNewLead: true,
      scheduleNextDay: false,
      nodes: [],
      edges: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(mockSequence);

    const result = await getSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('seq_123');
      expect(result.data.name).toBe('Welcome Sequence');
    }
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(getSequence(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain('seq_123');
      }
    );
  });

  it('should return NOT_FOUND when sequence belongs to different organization', async () => {
    // Query returns null because of the organization check in the where clause
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    const result = await getSequence(mockDb as never, {
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
      getSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'seq_123',
    };

    await expectResult(
      getSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockRejectedValueOnce(
      new Error('Database error')
    );

    await expect(getSequence(mockDb as never, validInput)).rejects.toThrow(
      'Database error'
    );
  });
});
