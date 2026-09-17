import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { setInitialSkillState } from './set-initial-skill-state.service.js';

const mockDb = {
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

const validInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
  loadedSkillIds: ['create-ad'],
  skillRegistryVersion: 1,
};

describe('setInitialSkillState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('persists the initial skill set + registry version atomically', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { loadedSkillIds: ['create-ad'], skillRegistryVersion: 1 },
    ]);

    const result = await setInitialSkillState(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.loadedSkillIds).toEqual(['create-ad']);
      expect(result.data.skillRegistryVersion).toBe(1);
    }
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.set).toHaveBeenCalledTimes(1);
  });

  it('dedupes the input array before writing', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { loadedSkillIds: ['create-ad'], skillRegistryVersion: 1 },
    ]);

    const result = await setInitialSkillState(mockDb as never, {
      ...validInput,
      loadedSkillIds: ['create-ad', 'create-ad'],
    });

    expect(result.success).toBe(true);
    const setCallArg = mockDb.set.mock.calls[0]?.[0] as {
      loadedSkillIds: string[];
    };
    expect(setCallArg.loadedSkillIds).toEqual(['create-ad']);
  });

  it('accepts an empty array (classifier returned only default)', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { loadedSkillIds: [], skillRegistryVersion: 1 },
    ]);

    const result = await setInitialSkillState(mockDb as never, {
      ...validInput,
      loadedSkillIds: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.loadedSkillIds).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR for unknown skill id', async () => {
    const result = await setInitialSkillState(mockDb as never, {
      ...validInput,
      loadedSkillIds: ['create-ad', 'totally-not-a-skill'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('totally-not-a-skill');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await setInitialSkillState(mockDb as never, {
      ...validInput,
      conversationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for non-positive registry version', async () => {
    const result = await setInitialSkillState(mockDb as never, {
      ...validInput,
      skillRegistryVersion: 0,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the conversation row is missing', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await setInitialSkillState(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB unavailable'));

    const result = await setInitialSkillState(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
