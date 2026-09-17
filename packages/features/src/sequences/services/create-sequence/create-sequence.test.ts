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
import { createSequence } from './create-sequence.service.js';

describe('createSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Welcome Sequence',
    description: 'Initial outreach for new leads',
    isActive: false,
    triggerOnNewLead: true,
    scheduleNextDay: false,
    nodes: [{ id: 'trigger_1', type: 'trigger', data: {} }],
    edges: [],
    createdById: 'user_123',
  };

  it('should create sequence with valid input', async () => {
    const mockSequence = {
      id: 'seq_123',
      ...validInput,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockSequence]);

    const result = await createSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Welcome Sequence');
      expect(result.data.organizationId).toBe('org_123');
      expect(result.data.isActive).toBe(false);
    }
  });

  it('should create sequence with minimal input', async () => {
    const minimalInput = {
      organizationId: 'org_123',
      name: 'Basic Sequence',
    };

    const mockSequence = {
      id: 'seq_123',
      organizationId: 'org_123',
      name: 'Basic Sequence',
      description: null,
      isActive: false,
      triggerOnNewLead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([mockSequence]);

    const result = await createSequence(mockDb as never, minimalInput);

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      name: 'Test Sequence',
    };

    await expectResult(
      createSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      createSequence(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty name', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      name: '',
    };

    await expectResult(
      createSequence(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expect(createSequence(mockDb as never, validInput)).rejects.toThrow(
      'Database error'
    );
  });
});
