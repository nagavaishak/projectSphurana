import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// The real `../../templates/index.js` barrel is used on purpose: the template
// builder is a pure function over `node:crypto.randomUUID`, and it already
// returns the `name: 'Default Follow-Up Sequence'` this suite asserts on, so
// the stub added nothing but drift. Under `isolate: false` a file-local
// `vi.mock` of this internal barrel would also persist on the shared worker
// graph and DELETE the exports the factory omitted
// (`createReviewCampaignSequenceTemplate`,
// `createReactivationCampaignSequenceTemplate`) for every later test file.
import {
  DEFAULT_SEQUENCE_NAME,
  createDefaultSequence,
} from './create-default-sequence.service.js';

describe('createDefaultSequence', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    createdById: 'user_123',
  };

  it('should create default sequence when none exists', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'seq_default',
        organizationId: 'org_123',
        name: 'Default Follow-Up Sequence',
        description: 'Auto-generated follow-up sequence',
        isActive: false,
        triggerOnNewLead: true,
        scheduleNextDay: false,
        nodes: [{ id: 'node_1', type: 'trigger' }],
        edges: [],
        createdById: 'user_123',
      },
    ]);

    const result = await createDefaultSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Default Follow-Up Sequence');
      expect(result.data.isActive).toBe(false);
      expect(result.data.triggerOnNewLead).toBe(true);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return existing sequence if already exists', async () => {
    const existingSequence = {
      id: 'seq_existing',
      organizationId: 'org_123',
      name: 'Default Follow-Up Sequence',
      isActive: true,
    };
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(existingSequence);

    const result = await createDefaultSequence(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('seq_existing');
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should create sequence with correct template values', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([{ id: 'seq_new' }]);

    await createDefaultSequence(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_123',
        name: 'Default Follow-Up Sequence',
        isActive: false,
        triggerOnNewLead: true,
        scheduleNextDay: false,
        createdById: 'user_123',
      })
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      createdById: 'user_123',
    };

    const result = await createDefaultSequence(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing createdById', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    const result = await createDefaultSequence(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.sequence.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expect(
      createDefaultSequence(mockDb as never, validInput)
    ).rejects.toThrow('Database error');
  });

  it('should export DEFAULT_SEQUENCE_NAME constant', () => {
    expect(DEFAULT_SEQUENCE_NAME).toBe('Default Follow-Up Sequence');
  });
});
