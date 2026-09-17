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
import { createVoiceScript } from './create-voice-script.service.js';

describe('createVoiceScript', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Reset returning mock implementation to ensure clean state
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Sales Script',
    initialMessage: 'Hello, this is a call from our team.',
    script: 'You are a helpful sales assistant...',
    qualificationQuestions: ['What is your budget?', 'When do you need this?'],
    followUps: ['Send pricing info', 'Schedule demo'],
    isDefault: false,
    agentConfig: {
      voice: 'voice_123',
      language: 'en-US',
    },
  };

  it('should create voice script with valid input', async () => {
    const createdScript = {
      id: 'script_123',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdScript]);

    const result = await createVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Sales Script');
      expect(result.data.organizationId).toBe('org_123');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should unset other defaults when creating default script', async () => {
    const defaultInput = {
      ...validInput,
      isDefault: true,
    };

    const createdScript = {
      id: 'script_123',
      ...defaultInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([createdScript]);

    const result = await createVoiceScript(mockDb as never, defaultInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ isDefault: false });
  });

  it('should create script without optional fields', async () => {
    const minimalInput = {
      organizationId: 'org_123',
      name: 'Basic Script',
      initialMessage: 'Hello!',
    };

    const createdScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Basic Script',
      isDefault: false,
      initialMessage: 'Hello!',
      script: null,
      qualificationQuestions: [],
      followUps: [],
      agentConfig: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdScript]);

    const result = await createVoiceScript(mockDb as never, minimalInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Basic Script');
    }
  });

  it('should create script with qualification questions', async () => {
    const inputWithQuestions = {
      ...validInput,
      qualificationQuestions: [
        'What is your timeline?',
        'What is your budget range?',
        'Who is the decision maker?',
      ],
    };

    const createdScript = {
      id: 'script_123',
      ...inputWithQuestions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdScript]);

    const result = await createVoiceScript(mockDb as never, inputWithQuestions);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.qualificationQuestions).toHaveLength(3);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      name: 'Test Script',
    };

    await expectResult(
      createVoiceScript(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      createVoiceScript(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createVoiceScript(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe('Failed to create voice script');
    });
  });
});
