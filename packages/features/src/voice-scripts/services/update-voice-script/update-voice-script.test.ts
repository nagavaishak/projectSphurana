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
import { updateVoiceScript } from './update-voice-script.service.js';

describe('updateVoiceScript', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'script_123',
    organizationId: 'org_123',
    name: 'Updated Script Name',
  };

  it('should update voice script with valid input', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Old Name',
      isDefault: false,
    };

    const updatedScript = {
      ...existingScript,
      name: 'Updated Script Name',
      updatedAt: new Date(),
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.returning.mockResolvedValueOnce([updatedScript]);

    const result = await updateVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Script Name');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should update multiple fields', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Old Name',
      initialMessage: 'Old message',
      script: 'Old script',
      isDefault: false,
    };

    const multiFieldInput = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'New Name',
      initialMessage: 'New greeting message',
      script: 'New script content',
      qualificationQuestions: ['New Q1', 'New Q2'],
      followUps: ['New F1'],
    };

    const updatedScript = {
      ...existingScript,
      ...multiFieldInput,
      updatedAt: new Date(),
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.returning.mockResolvedValueOnce([updatedScript]);

    const result = await updateVoiceScript(mockDb as never, multiFieldInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('New Name');
      expect(result.data.initialMessage).toBe('New greeting message');
    }
  });

  it('should unset other defaults when setting as default', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'My Script',
      isDefault: false,
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingScript, isDefault: true },
    ]);

    const result = await updateVoiceScript(mockDb as never, {
      id: 'script_123',
      organizationId: 'org_123',
      isDefault: true,
    });

    expect(result.success).toBe(true);
    // Should have called update twice - once to unset defaults, once for update
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ isDefault: false });
  });

  it('should update agent config', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Script',
      isDefault: false,
      agentConfig: null,
    };

    const newAgentConfig = {
      voice: 'voice_456',
      language: 'en-GB',
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingScript, agentConfig: newAgentConfig },
    ]);

    const result = await updateVoiceScript(mockDb as never, {
      id: 'script_123',
      organizationId: 'org_123',
      agentConfig: newAgentConfig,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentConfig).toEqual(newAgentConfig);
    }
  });

  it('should return NOT_FOUND when script does not exist', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateVoiceScript(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Voice script not found');
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      name: 'New Name',
    };

    await expectResult(
      updateVoiceScript(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Script',
      isDefault: false,
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateVoiceScript(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe('Failed to update voice script');
    });
  });
});
