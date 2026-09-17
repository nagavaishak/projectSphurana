import {
  mockSNSSMSService,
  mockTelnyxAiService,
} from '@borradh-workspace/integrations';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as useCreditsModule from '../../../billing/services/use-credits/use-credits.service.js';
import * as selectPhoneNumberModule from '../../../phone-numbers/services/select-phone-number/select-phone-number.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { processPendingExecutions } from './sequence-executor.service.js';

const mockSendSMS = vi.mocked(mockSNSSMSService.sendSMS);
const mockIntegrations = {
  mockInitiateVoiceCall: vi.mocked(mockTelnyxAiService.initiateVoiceCall),
  mockBuildScriptAssistantConfig: vi.mocked(
    mockTelnyxAiService.buildScriptAssistantConfig
  ),
  mockEnsureAssistantSynced: vi.mocked(
    mockTelnyxAiService.ensureAssistantSynced
  ),
};

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module leaks outward (deleting the exports it omits) and silently misses
// whenever an earlier file already imported the real module (use-credits and
// select-phone-number each have their own test file). Run-time spies are
// load-order independent and restore cleanly.
let mockUseCredits: MockInstance;
let mockSelectPhoneNumber: MockInstance;

describe('processPendingExecutions', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSendSMS.mockReset();
    mockUseCredits = vi.spyOn(useCreditsModule, 'useCredits');
    mockSelectPhoneNumber = vi
      .spyOn(selectPhoneNumberModule, 'selectPhoneNumber')
      .mockResolvedValue({ success: false } as never);
    mockIntegrations.mockBuildScriptAssistantConfig.mockReset();
    mockIntegrations.mockEnsureAssistantSynced.mockReset();
    mockIntegrations.mockInitiateVoiceCall.mockReset();
    // Default: credits succeed
    mockUseCredits.mockResolvedValue({
      success: true,
      data: { remainingBalance: 100 },
    });
    // Default: assistant sync succeeds
    mockIntegrations.mockEnsureAssistantSynced.mockResolvedValue(
      'assistant_123'
    );
    mockIntegrations.mockBuildScriptAssistantConfig.mockReturnValue({
      name: 'Test Agent',
      instructions: 'test prompt',
      enabled_features: ['telephony'],
    });
  });

  afterEach(() => {
    mockUseCredits.mockRestore();
    mockSelectPhoneNumber.mockRestore();
  });

  it('should process pending leads with active sequences', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'step_1',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
      phone: '+1234567890',
      firstName: 'John',
      lastName: 'Doe',
      consentEmail: true,
      consentSms: true,
      consentVoice: true,
    };

    const currentStep = {
      id: 'step_1',
      sequenceId: 'seq_123',
      type: 'sms',
      order: 1,
      nodeId: 'node_1',
      config: { message: 'Hello {{firstName}}!' },
    };

    const organization = {
      id: 'org_123',
      businessHours: null,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(organization);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(currentStep);
    mockSendSMS.mockResolvedValueOnce({ success: true, messageId: 'msg_123' });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.query.sequenceStep.findMany.mockResolvedValueOnce([]); // No more steps
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
      expect(result.data.failed).toBe(0);
    }
  });

  it('should return success with zero counts when no pending leads', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(0);
      expect(result.data.failed).toBe(0);
    }
  });

  it('should skip leads without sequence assigned', async () => {
    const leadWithoutSequence = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: null, // No sequence
      sequenceStatus: 'active',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([leadWithoutSequence]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(0);
    }
  });

  it('should mark sequence as completed when no more steps', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: null,
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
    });
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findMany.mockResolvedValueOnce([]); // No steps
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceStatus: 'completed',
        nextActionAt: null,
      })
    );
  });

  it('should handle step execution failure', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'step_1',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
      phone: null, // No phone - will cause SMS to fail
      consentEmail: true,
      consentSms: true, // Has consent but no phone
      consentVoice: true,
    };

    const currentStep = {
      id: 'step_1',
      sequenceId: 'seq_123',
      type: 'sms',
      order: 1,
      config: { message: 'Hello!' },
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
    });
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(currentStep);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.failed).toBe(1);
    }
  });

  it('should process condition steps and branch correctly', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'condition_step',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
      status: 'qualified',
    };

    const conditionStep = {
      id: 'condition_step',
      sequenceId: 'seq_123',
      type: 'condition',
      order: 1,
      nodeId: 'condition_1',
      config: {
        field: 'lead.status',
        operator: 'equals',
        value: 'qualified',
        trueBranchNodeId: 'sms_node',
        falseBranchNodeId: 'email_node',
      },
    };

    const nextStep = {
      id: 'sms_step',
      sequenceId: 'seq_123',
      type: 'sms',
      order: 2,
      nodeId: 'sms_node',
      config: { message: 'You are qualified!' },
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
    });
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(conditionStep);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(nextStep); // Branch step
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
    }
  });

  it('should handle wait steps correctly', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'wait_step',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
    };

    const waitStep = {
      id: 'wait_step',
      sequenceId: 'seq_123',
      type: 'wait',
      order: 1,
      config: { duration: '1h' },
    };

    const nextStep = {
      id: 'sms_step',
      sequenceId: 'seq_123',
      type: 'sms',
      order: 2,
      config: { message: 'Hello!' },
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
    });
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(waitStep);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.query.sequenceStep.findMany.mockResolvedValueOnce([nextStep]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
    }
  });

  it('should handle unknown step types gracefully', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'unknown_step',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
    };

    const unknownStep = {
      id: 'unknown_step',
      sequenceId: 'seq_123',
      type: 'unknown_type',
      order: 1,
      config: {},
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_123',
    });
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(unknownStep);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.failed).toBe(1);
    }
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.lead.findMany.mockRejectedValueOnce(
      new Error('Database error')
    );

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should skip SMS step when lead lacks SMS consent', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'step_1',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
      phone: '+1234567890',
      firstName: 'John',
      consentEmail: true,
      consentSms: false, // No SMS consent
      consentVoice: false,
    };

    const smsStep = {
      id: 'step_1',
      sequenceId: 'seq_123',
      type: 'sms',
      order: 1,
      nodeId: 'node_1',
      config: { message: 'Hello {{firstName}}!' },
    };

    const organization = {
      id: 'org_123',
      businessHours: null,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(organization);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(smsStep);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.query.sequenceStep.findMany.mockResolvedValueOnce([]); // No more steps
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
      expect(result.data.failed).toBe(0);
    }
    // SMS service should not have been called
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it('should skip voice_call step when lead lacks voice consent', async () => {
    const pendingLead = {
      id: 'lead_123',
      organizationId: 'org_123',
      sequenceId: 'seq_123',
      sequenceStatus: 'active',
      currentStepId: 'step_1',
      nextActionAt: new Date(Date.now() - 1000),
      humanTakeoverRequested: false,
      phone: '+1234567890',
      firstName: 'John',
      consentEmail: true,
      consentSms: true,
      consentVoice: false, // No voice consent
    };

    const voiceStep = {
      id: 'step_1',
      sequenceId: 'seq_123',
      type: 'voice_call',
      order: 1,
      nodeId: 'node_1',
      config: { agentConfigId: 'script_123' },
    };

    const organization = {
      id: 'org_123',
      businessHours: null,
    };

    mockDb.query.lead.findMany.mockResolvedValueOnce([pendingLead]);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(organization);
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequenceStep.findFirst.mockResolvedValueOnce(voiceStep);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);
    mockDb.query.sequenceStep.findMany.mockResolvedValueOnce([]); // No more steps
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
      expect(result.data.failed).toBe(0);
    }
    // Voice call should not have been initiated
    expect(mockIntegrations.mockInitiateVoiceCall).not.toHaveBeenCalled();
  });

  it('should process batch of leads up to limit', async () => {
    const pendingLeads = Array(5)
      .fill(null)
      .map((_, i) => ({
        id: `lead_${i}`,
        organizationId: 'org_123',
        sequenceId: null, // No sequence - will be skipped
        sequenceStatus: 'active',
        nextActionAt: new Date(Date.now() - 1000),
        humanTakeoverRequested: false,
      }));

    mockDb.query.lead.findMany.mockResolvedValueOnce(pendingLeads);

    const result = await processPendingExecutions(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(0); // All skipped due to no sequenceId
    }
  });
});
