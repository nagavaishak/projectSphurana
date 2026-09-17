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
import { assignSequence } from './assign-sequence.service.js';

describe('assignSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    leadId: 'lead_123',
    sequenceId: 'seq_123',
    organizationId: 'org_123',
  };

  const existingLead = {
    id: 'lead_123',
    organizationId: 'org_123',
    firstName: 'John',
    status: 'new',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Welcome Sequence',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should assign sequence to lead when both exist and sequence is active', async () => {
    const updatedLead = {
      ...existingLead,
      sequenceId: validInput.sequenceId,
      sequenceStatus: 'active',
      sequenceStartedAt: new Date(),
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockResolvedValueOnce([updatedLead]);

    const result = await assignSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sequenceId).toBe(validInput.sequenceId);
      expect(result.data.sequenceStatus).toBe('active');
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when lead does not exist', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(assignSequence(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.leadId);
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(assignSequence(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.sequenceId);
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE when sequence is not active', async () => {
    const inactiveSequence = {
      ...existingSequence,
      isActive: false,
    };

    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(inactiveSequence);

    await expectResult(assignSequence(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('inactive');
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing leadId', async () => {
    const invalidInput = {
      sequenceId: 'seq_123',
      organizationId: 'org_123',
    };

    await expectResult(
      assignSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing sequenceId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      organizationId: 'org_123',
    };

    await expectResult(
      assignSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      sequenceId: 'seq_123',
    };

    await expectResult(
      assignSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty leadId', async () => {
    const invalidInput = {
      leadId: '',
      sequenceId: 'seq_123',
      organizationId: 'org_123',
    };

    await expectResult(
      assignSequence(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty sequenceId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      sequenceId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      assignSequence(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(assignSequence(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
