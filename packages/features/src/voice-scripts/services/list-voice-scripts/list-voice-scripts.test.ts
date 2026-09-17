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
import { listVoiceScripts } from './list-voice-scripts.service.js';

describe('listVoiceScripts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    limit: 20,
    offset: 0,
  };

  it('should return list of voice scripts for organization', async () => {
    const scripts = [
      {
        id: 'script_1',
        organizationId: 'org_123',
        name: 'Sales Script',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'script_2',
        organizationId: 'org_123',
        name: 'Support Script',
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockDb.query.voiceScript.findMany.mockResolvedValueOnce(scripts);

    const result = await listVoiceScripts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should return empty array when no scripts exist', async () => {
    mockDb.query.voiceScript.findMany.mockResolvedValueOnce([]);

    const result = await listVoiceScripts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
    }
  });

  it('should return scripts sorted by isDefault and createdAt', async () => {
    const scripts = [
      {
        id: 'script_1',
        organizationId: 'org_123',
        name: 'Default Script',
        isDefault: true,
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'script_2',
        organizationId: 'org_123',
        name: 'Other Script',
        isDefault: false,
        createdAt: new Date('2024-01-15'),
      },
    ];

    mockDb.query.voiceScript.findMany.mockResolvedValueOnce(scripts);

    const result = await listVoiceScripts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      // Default script should come first
      expect(result.data.items[0].isDefault).toBe(true);
    }
  });

  it('should apply pagination with limit and offset', async () => {
    const scripts = [
      {
        id: 'script_3',
        organizationId: 'org_123',
        name: 'Script 3',
        isDefault: false,
      },
      {
        id: 'script_4',
        organizationId: 'org_123',
        name: 'Script 4',
        isDefault: false,
      },
    ];

    mockDb.query.voiceScript.findMany.mockResolvedValueOnce(scripts);

    const result = await listVoiceScripts(mockDb as never, {
      ...validInput,
      limit: 2,
      offset: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.limit).toBe(2);
      expect(result.data.offset).toBe(2);
    }
  });

  it('should return scripts with full configuration', async () => {
    const scriptsWithConfig = [
      {
        id: 'script_1',
        organizationId: 'org_123',
        name: 'Full Config Script',
        isDefault: true,
        initialMessage: 'Hello!',
        script: 'Full script content...',
        qualificationQuestions: ['Q1', 'Q2'],
        followUps: ['F1', 'F2'],
        agentConfig: { voice: 'voice_123', language: 'en-US' },
        voiceProviderAgentId: 'elevenlabs_agent_123',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockDb.query.voiceScript.findMany.mockResolvedValueOnce(scriptsWithConfig);

    const result = await listVoiceScripts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      const script = result.data.items[0];
      expect(script.qualificationQuestions).toHaveLength(2);
      expect(script.followUps).toHaveLength(2);
      expect(script.voiceProviderAgentId).toBe('elevenlabs_agent_123');
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      limit: 20,
      offset: 0,
    };

    await expectResult(
      listVoiceScripts(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
