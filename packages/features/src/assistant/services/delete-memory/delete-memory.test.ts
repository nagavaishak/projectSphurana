import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import * as checkAdminAccessModule from '../../../organizations/services/check-admin-access/check-admin-access.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted factory both leaks into later files and
// silently misses whenever an earlier file already imported the real module.
let checkAdminAccessMock: MockInstance;

import { ErrorCodes } from '../../../shared/index.js';
import { deleteMemory } from './delete-memory.service.js';

interface SelectChain {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

interface DeleteChain {
  delete: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
}

function createSelectChain(): SelectChain {
  const chain = {} as SelectChain;
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  return chain;
}

function createDeleteChain(): DeleteChain {
  const chain = {} as DeleteChain;
  chain.delete = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn();
  return chain;
}

const validInput = {
  id: 'mem-1',
  organizationId: 'org-1',
  userId: 'user-1',
};

describe('deleteMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAdminAccessMock = vi
      .spyOn(checkAdminAccessModule, 'checkAdminAccess')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    checkAdminAccessMock.mockRestore();
  });

  it('deletes a personal memory owned by the caller', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    const deleteChain = createDeleteChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn(() => deleteChain);
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: 'user-1', type: 'preference' },
    ]);
    deleteChain.returning.mockResolvedValueOnce([{ id: 'mem-1' }]);

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
      expect(result.data.knowledgeEntryId).toBe('mem-1');
    }
    expect(checkAdminAccessMock).not.toHaveBeenCalled();
  });

  it("blocks deleting another user's personal memory with FORBIDDEN", async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn();
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: 'other-user', type: 'preference' },
    ]);

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('lets an admin delete an org-wide memory', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    const deleteChain = createDeleteChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn(() => deleteChain);
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: null, type: 'preference' },
    ]);
    checkAdminAccessMock.mockResolvedValueOnce({
      success: true,
      data: { hasAccess: true, role: 'admin' },
    });
    deleteChain.returning.mockResolvedValueOnce([{ id: 'mem-1' }]);

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(checkAdminAccessMock).toHaveBeenCalledWith(mockDb, {
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  it('blocks a non-admin from deleting an org-wide memory', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn();
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: null, type: 'preference' },
    ]);
    checkAdminAccessMock.mockResolvedValueOnce({
      success: true,
      data: { hasAccess: false, role: 'member' },
    });

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when entry does not exist', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn();
    selectChain.limit.mockResolvedValueOnce([]);

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when entry is not a preference (e.g. operational_snapshot)', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn();
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: null, type: 'operational_snapshot' },
    ]);

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when DELETE returns empty (race against parallel delete)', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    const deleteChain = createDeleteChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn(() => deleteChain);
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: 'user-1', type: 'preference' },
    ]);
    deleteChain.returning.mockResolvedValueOnce([]);

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    const mockDb = { select: vi.fn() };

    const result = await deleteMemory(mockDb as never, {
      id: '',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure during lookup', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn();
    selectChain.limit.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure during delete', async () => {
    const mockDb = {} as Record<string, unknown>;
    const selectChain = createSelectChain();
    const deleteChain = createDeleteChain();
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn(() => deleteChain);
    selectChain.limit.mockResolvedValueOnce([
      { id: 'mem-1', userId: 'user-1', type: 'preference' },
    ]);
    deleteChain.returning.mockRejectedValueOnce(new Error('DB write failed'));

    const result = await deleteMemory(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
