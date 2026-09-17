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
import { SequenceErrorCodes } from '../../models/sequence-error.types.js';
import { activateSequence } from './activate-sequence.service.js';

describe('activateSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'seq_123',
    organizationId: 'org_123',
  };

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Test Sequence',
    isActive: false,
    nodes: [
      {
        id: 'trigger_1',
        type: 'trigger',
        data: { metadata: { triggerType: 'new_lead' } },
      },
      { id: 'sms_1', type: 'sms', data: { metadata: { message: 'Hello!' } } },
    ],
    edges: [{ source: 'trigger_1', target: 'sms_1' }],
  };

  const creditBalance = {
    id: 'bal_123',
    organizationId: 'org_123',
    balance: 50000,
    autoRefillEnabled: false,
  };

  it('should activate sequence with valid nodes', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(creditBalance);
    // Mock delete existing steps
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);
    // Mock insert new steps
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    // Mock update sequence to active
    mockDb.returning.mockResolvedValueOnce([
      { ...existingSequence, isActive: true },
    ]);

    const result = await activateSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      activateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('seq_123');
    });
  });

  it('should return INVALID_STATE when sequence is already active', async () => {
    const activeSequence = { ...existingSequence, isActive: true };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(activeSequence);

    await expectResult(
      activateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('already active');
    });
  });

  it('should return INSUFFICIENT_CREDITS_TO_PUBLISH when credits too low', async () => {
    const lowBalance = {
      ...creditBalance,
      balance: 500,
      autoRefillEnabled: false,
    };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(lowBalance);

    await expectResult(
      activateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(
        SequenceErrorCodes.INSUFFICIENT_CREDITS_TO_PUBLISH
      );
      expect(error.message).toContain('Insufficient credits');
    });
  });

  it('should allow activation when auto-refill is enabled even with low credits', async () => {
    const lowBalanceWithAutoRefill = {
      ...creditBalance,
      balance: 500,
      autoRefillEnabled: true,
    };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(
      lowBalanceWithAutoRefill
    );
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingSequence, isActive: true },
    ]);

    const result = await activateSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('should return INVALID_STATE when sequence has no nodes', async () => {
    const emptySequence = { ...existingSequence, nodes: [] };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(emptySequence);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(creditBalance);

    await expectResult(
      activateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('without any nodes');
    });
  });

  it('should return INVALID_STATE when sequence has only trigger node', async () => {
    const triggerOnlySequence = {
      ...existingSequence,
      nodes: [{ id: 'trigger_1', type: 'trigger', data: { metadata: {} } }],
      edges: [],
    };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(triggerOnlySequence);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(creditBalance);

    await expectResult(
      activateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(error.message).toContain('only trigger found');
    });
  });

  it('should return MISSING_INTEGRATIONS when voice call without voice script', async () => {
    const voiceSequence = {
      ...existingSequence,
      nodes: [
        { id: 'trigger_1', type: 'trigger', data: { metadata: {} } },
        { id: 'voice_1', type: 'voice_call', data: { metadata: {} } },
      ],
      edges: [{ source: 'trigger_1', target: 'voice_1' }],
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(voiceSequence);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce(creditBalance);
    // Mock voice script check - no script found
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      activateSequence(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(SequenceErrorCodes.MISSING_INTEGRATIONS);
      expect(error.details?.missingIntegrations).toBeDefined();
    });
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      activateSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'seq_123',
    };

    await expectResult(
      activateSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
