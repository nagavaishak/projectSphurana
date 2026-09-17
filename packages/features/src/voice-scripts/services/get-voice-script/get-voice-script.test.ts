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
import {
  getDefaultVoiceScript,
  getVoiceScript,
} from './get-voice-script.service.js';

describe('getVoiceScript', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'script_123',
    organizationId: 'org_123',
  };

  it('should return voice script when found', async () => {
    const script = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Sales Script',
      isDefault: true,
      initialMessage: 'Hello!',
      script: 'Sales script content',
      qualificationQuestions: ['What is your budget?'],
      followUps: ['Send email'],
      agentConfig: { voice: 'voice_123' },
      voiceProviderAgentId: 'elevenlabs_agent_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(script);

    const result = await getVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('script_123');
      expect(result.data.name).toBe('Sales Script');
      expect(result.data.isDefault).toBe(true);
    }
  });

  it('should return script with voice provider agent ID', async () => {
    const scriptWithProvider = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Synced Script',
      isDefault: false,
      voiceProviderAgentId: 'elevenlabs_agent_abc',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(
      scriptWithProvider
    );

    const result = await getVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.voiceProviderAgentId).toBe('elevenlabs_agent_abc');
    }
  });

  it('should return NOT_FOUND when script does not exist', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(null);

    await expectResult(getVoiceScript(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toBe('Voice script not found');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {};

    await expectResult(
      getVoiceScript(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('getDefaultVoiceScript', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return default voice script when found', async () => {
    const defaultScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Default Sales Script',
      isDefault: true,
      initialMessage: 'Hello from our team!',
      script: 'Default script content',
      qualificationQuestions: [],
      followUps: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(defaultScript);

    const result = await getDefaultVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('script_123');
      expect(result.data?.isDefault).toBe(true);
    }
  });

  it('should return null when no default script exists', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(null);

    const result = await getDefaultVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      getDefaultVoiceScript(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
