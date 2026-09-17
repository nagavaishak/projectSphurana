import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `and` / `eq` are re-exported from `@borradh-workspace/database`'s barrel —
// we mock them as identity-ish helpers so the service's WHERE clause
// composes without exploding. The mock DB chain ignores the actual
// conditions and just records that update/where/returning were called.

import { ErrorCodes } from '../../../shared/index.js';
import { appendLoadedSkill } from './append-loaded-skill.service.js';

const mockDb = {
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

const validInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
  // `create-ad` is a real skill id from the registry shipped in W-C03-A
  skillId: 'create-ad',
};

describe('appendLoadedSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('appends a new skill and returns the updated array', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { loadedSkillIds: ['default', 'create-ad'] },
    ]);

    const result = await appendLoadedSkill(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.loadedSkillIds).toEqual(['default', 'create-ad']);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
  });

  it('is idempotent — appending an already-loaded skill returns the same set', async () => {
    // The Postgres `array(select distinct unnest(... || ...))` SQL dedupes;
    // the test simulates the DB returning the same array twice.
    mockDb.returning
      .mockResolvedValueOnce([{ loadedSkillIds: ['default', 'create-ad'] }])
      .mockResolvedValueOnce([{ loadedSkillIds: ['default', 'create-ad'] }]);

    const first = await appendLoadedSkill(mockDb as never, validInput);
    const second = await appendLoadedSkill(mockDb as never, validInput);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data.loadedSkillIds).toEqual(second.data.loadedSkillIds);
      // No duplicates — `create-ad` appears exactly once.
      const occurrences = second.data.loadedSkillIds.filter(
        (id) => id === 'create-ad'
      ).length;
      expect(occurrences).toBe(1);
    }
  });

  it('returns VALIDATION_ERROR for an unknown skill id', async () => {
    const result = await appendLoadedSkill(mockDb as never, {
      ...validInput,
      skillId: 'totally-not-a-real-skill',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('totally-not-a-real-skill');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await appendLoadedSkill(mockDb as never, {
      ...validInput,
      conversationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the conversation does not exist or is not owned', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await appendLoadedSkill(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await appendLoadedSkill(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('produces union under concurrent appends (no lost-update)', async () => {
    // Simulates Postgres serialising two parallel UPDATEs on the same row.
    // The first update returns ['default', 'create-ad']; the second returns
    // ['default', 'create-ad', 'schedule-post']. Each call sees the row
    // state at the moment its UPDATE runs, and the union accumulates.
    mockDb.returning
      .mockResolvedValueOnce([{ loadedSkillIds: ['default', 'create-ad'] }])
      .mockResolvedValueOnce([
        { loadedSkillIds: ['default', 'create-ad', 'schedule-post'] },
      ]);

    const [r1, r2] = await Promise.all([
      appendLoadedSkill(mockDb as never, validInput),
      appendLoadedSkill(mockDb as never, {
        ...validInput,
        skillId: 'schedule-post',
      }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) {
      // The second caller sees both skills in the array — neither was lost.
      const finalArray = r2.data.loadedSkillIds;
      expect(finalArray).toContain('create-ad');
      expect(finalArray).toContain('schedule-post');
    }
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });
});
