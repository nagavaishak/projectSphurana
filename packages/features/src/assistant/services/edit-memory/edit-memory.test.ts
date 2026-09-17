import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import * as checkAdminAccessModule from '../../../organizations/services/check-admin-access/check-admin-access.service.js';
import * as embed from '../../knowledge/embed.js';

// Stub the embedding generator via a file-local `vi.spyOn` (restored in
// afterEach) so it never leaks into other test files under `isolate: false`.
let generateEmbeddingMock: ReturnType<typeof vi.spyOn>;

// Same treatment for the admin-access gate: a restored `vi.spyOn`, not a
// hoisted `vi.mock`. Under `isolate: false` a hoisted factory both leaks onto
// the shared module graph and silently misses whenever an earlier file already
// imported the real module.
let checkAdminAccessMock: MockInstance;

import { ErrorCodes } from '../../../shared/index.js';
import { editMemory } from './edit-memory.service.js';

const validInput = {
  id: 'mem-1',
  organizationId: 'org-1',
  userId: 'user-1',
  content: 'I prefer warm colour palettes for ad creative.',
};

const updatedAt = new Date('2026-04-26T11:00:00Z');

describe('editMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateEmbeddingMock = vi
      .spyOn(embed, 'generateEmbedding')
      .mockResolvedValue([0.1, 0.2, 0.3]);
    checkAdminAccessMock = vi
      .spyOn(checkAdminAccessModule, 'checkAdminAccess')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    generateEmbeddingMock.mockRestore();
    checkAdminAccessMock.mockRestore();
  });

  it('updates the content of a personal memory owned by the caller', async () => {
    const mockDb = {
      execute: vi
        .fn()
        // SELECT existing
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ])
        // UPDATE returning
        .mockResolvedValueOnce([{ id: 'mem-1', updated_at: updatedAt }]),
    };

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBe('mem-1');
      expect(result.data.content).toBe(validInput.content);
      // ISO-8601 string, not a Date — the settings UI consumes it verbatim.
      expect(result.data.updatedAt).toBe(updatedAt.toISOString());
    }
    expect(generateEmbeddingMock).toHaveBeenCalledWith(validInput.content);
    expect(checkAdminAccessMock).not.toHaveBeenCalled();
  });

  it("blocks editing another user's personal memory with FORBIDDEN", async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'other-user', type: 'preference' },
        ]),
    };

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('lets an admin edit an org-wide memory', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: null, type: 'preference' },
        ])
        .mockResolvedValueOnce([{ id: 'mem-1', updated_at: updatedAt }]),
    };
    checkAdminAccessMock.mockResolvedValueOnce({
      success: true,
      data: { hasAccess: true, role: 'owner' },
    });

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(checkAdminAccessMock).toHaveBeenCalledWith(mockDb, {
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  it('blocks a non-admin from editing an org-wide memory', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: null, type: 'preference' },
        ]),
    };
    checkAdminAccessMock.mockResolvedValueOnce({
      success: true,
      data: { hasAccess: false, role: 'member' },
    });

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when entry does not exist', async () => {
    const mockDb = { execute: vi.fn().mockResolvedValueOnce([]) };

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when entry is not a preference', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: null, type: 'operational_snapshot' },
        ]),
    };

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('rejects content that trips the POM brand hard-block with INVALID_INPUT', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ]),
    };

    const result = await editMemory(mockDb as never, {
      ...validInput,
      content: 'I prefer Botox treatments for the seasonal Q2 campaign.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_INPUT);
      expect(result.error.message).toMatch(/pom_brand/i);
    }
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
  });

  it('rejects content that trips the outcome-claim hard-block with INVALID_INPUT', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ]),
    };

    const result = await editMemory(mockDb as never, {
      ...validInput,
      content: 'Our skin booster delivers a 60% reduction in fine lines.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_INPUT);
      expect(result.error.message).toMatch(/outcome_claim/i);
    }
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
  });

  it('allows content with bare percentages (only outcome-paired numbers blocked)', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ])
        .mockResolvedValueOnce([{ id: 'mem-1', updated_at: updatedAt }]),
    };

    const result = await editMemory(mockDb as never, {
      ...validInput,
      content: 'We run 25% off promos every January.',
    });

    expect(result.success).toBe(true);
    expect(generateEmbeddingMock).toHaveBeenCalledTimes(1);
  });

  it('returns EXTERNAL_SERVICE_ERROR when embedding fails', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ]),
    };
    generateEmbeddingMock.mockRejectedValueOnce(new Error('OpenAI down'));

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
  });

  it('returns NOT_FOUND when UPDATE returns empty (race against parallel delete)', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ])
        .mockResolvedValueOnce([]),
    };

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing content', async () => {
    const mockDb = { execute: vi.fn() };

    const result = await editMemory(mockDb as never, {
      ...validInput,
      content: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for content > 2000 chars', async () => {
    const mockDb = { execute: vi.fn() };

    const result = await editMemory(mockDb as never, {
      ...validInput,
      content: 'x'.repeat(2001),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure during UPDATE', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'mem-1', user_id: 'user-1', type: 'preference' },
        ])
        .mockRejectedValueOnce(new Error('DB write failed')),
    };

    const result = await editMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
