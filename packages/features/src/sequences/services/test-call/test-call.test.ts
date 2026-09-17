import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false):
// `@borradh-workspace/env/voice` is canonically aliased in vite.config.ts and
// `select-phone-number.service.js` is an internal sibling other files import
// real. A hoisted per-file `vi.mock(...)` of either installs into the SHARED
// module registry and races with whichever file loads first. We register both
// with `vi.doMock` (non-hoisted) + `vi.resetModules()` + a dynamic `import()`
// of the service inside `beforeEach`, so nothing leaks into the shared
// registry. The env stub keeps this suite's specific config values so the
// value assertions are preserved exactly.
//
// Because `vi.resetModules()` re-evaluates `@borradh-workspace/integrations`,
// the Telnyx AI service mock is re-fetched from the SAME post-reset module
// graph the service imports — so the spies the test asserts on are the ones
// the service actually calls.
// ---------------------------------------------------------------------------

const VOICE_ENV = {
  TELNYX_API_KEY: 'test-api-key',
  TELNYX_OUTBOUND_PHONE_NUMBER: '+18001234567',
  ELEVENLABS_DEFAULT_VOICE_ID: 'voice_123',
  VOICE_TOOLS_WEBHOOK_URL:
    'https://api.example.com/webhooks/voice/telnyx/tools',
  TELNYX_TEXML_APP_ID: 'texml_app_123',
  TELNYX_ELEVENLABS_API_KEY_REF: 'el_key_ref',
  TELNYX_LLM_API_KEY_REF: 'openai_key_ref',
};

// Telnyx AI service mocks — re-fetched per test from the post-reset graph.
let mockCreateOutboundCall: ReturnType<typeof vi.fn>;
let mockBuildScriptAssistantConfig: ReturnType<typeof vi.fn>;
let mockEnsureAssistantSynced: ReturnType<typeof vi.fn>;

let testCall: typeof import('./test-call.service.js').testCall;

describe('testCall', () => {
  const mockDb = createMockDatabase();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockDb._resetMocks();

    // selectPhoneNumber defaults to failure so the trigger falls back to env.
    vi.doMock(
      '../../../phone-numbers/services/select-phone-number/select-phone-number.service.js',
      () => ({
        selectPhoneNumber: vi.fn().mockResolvedValue({ success: false }),
      })
    );
    vi.doMock('@borradh-workspace/env/voice', () => ({
      voiceEnv: { ...VOICE_ENV },
    }));

    ({ testCall } = await import('./test-call.service.js'));
    const { mockTelnyxAiService } = (await import(
      '@borradh-workspace/integrations'
    )) as unknown as {
      mockTelnyxAiService: Record<string, ReturnType<typeof vi.fn>>;
    };
    mockCreateOutboundCall = mockTelnyxAiService.createOutboundCall;
    mockBuildScriptAssistantConfig =
      mockTelnyxAiService.buildScriptAssistantConfig;
    mockEnsureAssistantSynced = mockTelnyxAiService.ensureAssistantSynced;

    mockCreateOutboundCall.mockReset();
    mockBuildScriptAssistantConfig.mockReset();
    mockEnsureAssistantSynced.mockReset();
    mockBuildScriptAssistantConfig.mockReturnValue({
      name: 'Test Agent',
      instructions: 'test prompt',
      model: 'gpt-4o-mini',
      voice_settings: { voice: 'ElevenLabs.voice_123' },
      enabled_features: ['telephony'],
    });
    mockEnsureAssistantSynced.mockResolvedValue('assistant_123');
  });

  afterEach(() => {
    vi.doUnmock(
      '../../../phone-numbers/services/select-phone-number/select-phone-number.service.js'
    );
    vi.doUnmock('@borradh-workspace/env/voice');
    vi.resetModules();
  });

  const validInput = {
    to: '+1234567890',
    agentConfigId: 'script_123',
    organizationId: 'org_123',
  };

  const existingScript = {
    id: 'script_123',
    organizationId: 'org_123',
    name: 'Test Agent',
    script: 'You are a test agent',
    qualificationQuestions: [],
    initialMessage: 'Hello!',
    agentConfig: null,
    voiceProviderAgentId: null,
  };

  const existingOrg = {
    id: 'org_123',
    name: 'Test Org',
  };

  it('should initiate test call successfully', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockCreateOutboundCall.mockResolvedValueOnce({
      call_control_id: 'call_123',
      call_session_id: 'session_123',
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);

    const result = await testCall(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.callControlId).toBe('call_123');
      expect(result.data.message).toContain('Test call initiated');
    }
    expect(mockBuildScriptAssistantConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: 'Test Agent',
        script: 'You are a test agent',
        orgName: 'Test Org',
        toolsWebhookUrl: 'https://api.example.com/webhooks/voice/telnyx/tools',
      })
    );
    expect(mockEnsureAssistantSynced).toHaveBeenCalledWith(
      null, // voiceProviderAgentId is null
      expect.any(Object)
    );
    expect(mockCreateOutboundCall).toHaveBeenCalledWith(
      'texml_app_123',
      expect.objectContaining({
        From: '+18001234567',
        To: '+1234567890',
        AIAssistantId: 'assistant_123',
        AIAssistantDynamicVariables: expect.objectContaining({
          __leadFirstName: 'Test',
          __leadLastName: 'User',
        }),
      })
    );
  });

  it('should normalize phone number to E.164 format', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockCreateOutboundCall.mockResolvedValueOnce({
      call_control_id: 'call_123',
      call_session_id: 'session_123',
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);

    await testCall(mockDb as never, {
      ...validInput,
      to: '(555) 123-4567',
    });

    expect(mockCreateOutboundCall).toHaveBeenCalledWith(
      'texml_app_123',
      expect.objectContaining({
        To: '+5551234567',
      })
    );
  });

  it('should return NOT_FOUND when voice script does not exist', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(null);

    const result = await testCall(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain(
        'AI agent configuration not found'
      );
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await testCall(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('Organization not found');
    }
  });

  it('should return VALIDATION_ERROR for missing to', async () => {
    const invalidInput = {
      agentConfigId: 'script_123',
      organizationId: 'org_123',
    };

    const result = await testCall(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing agentConfigId', async () => {
    const invalidInput = {
      to: '+1234567890',
      organizationId: 'org_123',
    };

    const result = await testCall(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      to: '+1234567890',
      agentConfigId: 'script_123',
    };

    const result = await testCall(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when Telnyx call fails', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockCreateOutboundCall.mockRejectedValueOnce(new Error('Telnyx API error'));

    const result = await testCall(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('Telnyx API error');
    }
  });

  it('should return INTERNAL_ERROR when assistant sync fails', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockEnsureAssistantSynced.mockRejectedValueOnce(
      new Error('Failed to sync assistant')
    );

    const result = await testCall(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('Failed to sync assistant');
    }
  });

  it('should store assistant ID back when it changes', async () => {
    const scriptWithExistingAgent = {
      ...existingScript,
      voiceProviderAgentId: 'old_assistant_id',
    };
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(
      scriptWithExistingAgent
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockEnsureAssistantSynced.mockResolvedValueOnce('new_assistant_id');
    mockCreateOutboundCall.mockResolvedValueOnce({
      call_control_id: 'call_123',
      call_session_id: 'session_123',
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValueOnce([]);

    const result = await testCall(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceProviderAgentId: 'new_assistant_id',
      })
    );
  });
});

describe('testCall - missing environment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/env/voice');
    vi.resetModules();
  });

  it('should return INVALID_STATE when TELNYX_API_KEY is missing', async () => {
    vi.doMock('@borradh-workspace/env/voice', () => ({
      voiceEnv: {
        TELNYX_API_KEY: undefined,
        TELNYX_OUTBOUND_PHONE_NUMBER: '+18001234567',
        VOICE_TOOLS_WEBHOOK_URL:
          'https://api.example.com/webhooks/voice/telnyx/tools',
      },
    }));

    const { testCall: testCallNoKey } = await import('./test-call.service.js');
    const mockDb = createMockDatabase();

    const result = await testCallNoKey(mockDb as never, {
      to: '+1234567890',
      agentConfigId: 'script_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(result.error.message).toContain('not configured');
    }
  });
});
