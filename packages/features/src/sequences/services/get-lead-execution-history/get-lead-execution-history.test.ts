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
import { getLeadExecutionHistory } from './get-lead-execution-history.service.js';

describe('getLeadExecutionHistory', () => {
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

  const existingSequence = {
    id: 'seq_123',
    organizationId: 'org_123',
    name: 'Follow-up Sequence',
    nodes: [{ id: 'node_1', type: 'email' }],
    edges: [{ source: 'node_1', target: 'node_2' }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const existingLead = {
    id: 'lead_123',
    firstName: 'John',
    lastName: 'Doe',
    currentStepId: 'step_1',
    sequenceStatus: 'active',
    nextActionAt: new Date(),
  };

  it('should return execution history successfully', async () => {
    const mockExecutions = [
      {
        execution: {
          id: 'exec_1',
          stepId: 'step_1',
          leadId: 'lead_123',
          sequenceId: 'seq_123',
          status: 'completed',
          result: { sent: true },
          scheduledAt: new Date(),
          executedAt: new Date(),
          errorMessage: null,
          createdAt: new Date(),
        },
        step: {
          nodeId: 'node_1',
        },
      },
    ];

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    // db.select().from().innerJoin().where().orderBy() chain
    mockDb.orderBy.mockResolvedValueOnce(mockExecutions);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);

    const result = await getLeadExecutionHistory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lead.id).toBe('lead_123');
      expect(result.data.lead.firstName).toBe('John');
      expect(result.data.lead.lastName).toBe('Doe');
      expect(result.data.sequence.id).toBe('seq_123');
      expect(result.data.sequence.name).toBe('Follow-up Sequence');
      expect(result.data.executions).toHaveLength(1);
      expect(result.data.executions[0].id).toBe('exec_1');
      expect(result.data.executions[0].status).toBe('completed');
      expect(result.data.executions[0].nodeId).toBe('node_1');
      expect(result.data.callbackInfo).toBeNull();
    }
  });

  it('should return callback info when voice call has callback requested', async () => {
    const mockVoiceCall = {
      id: 'call_1',
      callbackRequested: true,
      callbackTime: '2024-01-15T14:00:00.000Z',
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.orderBy.mockResolvedValueOnce([]);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(mockVoiceCall);

    const result = await getLeadExecutionHistory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.callbackInfo).not.toBeNull();
      expect(result.data.callbackInfo?.callbackRequested).toBe(true);
      expect(result.data.callbackInfo?.callbackTime).toBe(
        '2024-01-15T14:00:00.000Z'
      );
      expect(result.data.callbackInfo?.voiceCallId).toBe('call_1');
    }
  });

  it('should return null callbackInfo when voice call has no callback requested', async () => {
    const mockVoiceCall = {
      id: 'call_1',
      callbackRequested: false,
      callbackTime: null,
    };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.orderBy.mockResolvedValueOnce([]);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(mockVoiceCall);

    const result = await getLeadExecutionHistory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.callbackInfo).toBeNull();
    }
  });

  it('should return empty executions when no executions exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.orderBy.mockResolvedValueOnce([]);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);

    const result = await getLeadExecutionHistory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executions).toEqual([]);
    }
  });

  it('should handle lead with null nextActionAt', async () => {
    const leadWithNullNext = { ...existingLead, nextActionAt: null };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(leadWithNullNext);
    mockDb.orderBy.mockResolvedValueOnce([]);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);

    const result = await getLeadExecutionHistory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lead.nextActionAt).toBeNull();
    }
  });

  it('should handle sequence with null nodes and edges', async () => {
    const seqWithNulls = { ...existingSequence, nodes: null, edges: null };

    mockDb.query.sequence.findFirst.mockResolvedValueOnce(seqWithNulls);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.orderBy.mockResolvedValueOnce([]);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);

    const result = await getLeadExecutionHistory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sequence.nodes).toEqual([]);
      expect(result.data.sequence.edges).toEqual([]);
    }
  });

  it('should return NOT_FOUND when sequence does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getLeadExecutionHistory(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Sequence not found');
    });
  });

  it('should return NOT_FOUND when lead does not exist', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getLeadExecutionHistory(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('Lead not found');
    });
  });

  it('should return VALIDATION_ERROR for missing leadId', async () => {
    const invalidInput = {
      sequenceId: 'seq_123',
      organizationId: 'org_123',
    };

    await expectResult(
      getLeadExecutionHistory(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing sequenceId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      organizationId: 'org_123',
    };

    await expectResult(
      getLeadExecutionHistory(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      sequenceId: 'seq_123',
    };

    await expectResult(
      getLeadExecutionHistory(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty leadId', async () => {
    const invalidInput = {
      leadId: '',
      sequenceId: 'seq_123',
      organizationId: 'org_123',
    };

    await expectResult(
      getLeadExecutionHistory(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty sequenceId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      sequenceId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      getLeadExecutionHistory(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      leadId: 'lead_123',
      sequenceId: 'seq_123',
      organizationId: '',
    };

    await expectResult(
      getLeadExecutionHistory(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
