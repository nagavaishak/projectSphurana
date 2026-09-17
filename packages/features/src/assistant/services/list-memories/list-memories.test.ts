import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `drizzle-orm`'s real `count()` is a pure SQL builder — the chain mock
// accepts whatever value comes through, so we leave the module intact
// rather than mocking it (mocking it would shadow `relations` used by the
// schema files when transitively loaded).

import { ErrorCodes } from '../../../shared/index.js';
import { listMemories } from './list-memories.service.js';

interface ChainMock {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
}

function createChainMock(): ChainMock {
  const chain = {} as ChainMock;
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => chain);
  return chain;
}

const baseRow = {
  organizationId: 'org-1',
  type: 'preference',
  title: 'Memory: I prefer warm tones',
  content: 'I prefer warm color palettes for ad creative.',
  source: 'manual',
  confidence: 1.0,
  metadata: { savedBy: 'user-1', scope: 'personal' },
  createdAt: new Date('2026-04-26T10:00:00Z'),
  updatedAt: new Date('2026-04-26T10:00:00Z'),
};

const validInput = {
  organizationId: 'org-1',
  userId: 'user-1',
};

describe('listMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rows + total when entries exist', async () => {
    const mockDb = {} as Record<string, unknown>;
    const itemsChain = createChainMock();
    const countChain = createChainMock();
    let call = 0;
    mockDb.select = vi.fn(() => {
      call += 1;
      return call === 1 ? itemsChain : countChain;
    });
    itemsChain.offset.mockResolvedValueOnce([
      {
        id: 'mem-1',
        userId: 'user-1',
        ...baseRow,
      },
      {
        id: 'mem-2',
        userId: null,
        ...baseRow,
        title: 'Team memory: no Sunday ads',
      },
    ]);
    countChain.where.mockResolvedValueOnce([{ value: 2 }]);

    const result = await listMemories(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.items[0].userId).toBe('user-1');
      expect(result.data.items[1].userId).toBeNull();
    }
  });

  it('derives scope and serializes timestamps to ISO strings', async () => {
    const mockDb = {} as Record<string, unknown>;
    const itemsChain = createChainMock();
    const countChain = createChainMock();
    let call = 0;
    mockDb.select = vi.fn(() => {
      call += 1;
      return call === 1 ? itemsChain : countChain;
    });
    itemsChain.offset.mockResolvedValueOnce([
      { id: 'mem-1', userId: 'user-1', ...baseRow },
      { id: 'mem-2', userId: null, ...baseRow },
    ]);
    countChain.where.mockResolvedValueOnce([{ value: 2 }]);

    const result = await listMemories(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].scope).toBe('personal');
      expect(result.data.items[1].scope).toBe('organization');
      expect(result.data.items[0].createdAt).toBe('2026-04-26T10:00:00.000Z');
      expect(result.data.items[0].updatedAt).toBe('2026-04-26T10:00:00.000Z');
    }
  });

  it('returns empty list + total=0 when no entries exist', async () => {
    const mockDb = {} as Record<string, unknown>;
    const itemsChain = createChainMock();
    const countChain = createChainMock();
    let call = 0;
    mockDb.select = vi.fn(() => {
      call += 1;
      return call === 1 ? itemsChain : countChain;
    });
    itemsChain.offset.mockResolvedValueOnce([]);
    countChain.where.mockResolvedValueOnce([{ value: 0 }]);

    const result = await listMemories(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });

  it('respects custom limit + offset', async () => {
    const mockDb = {} as Record<string, unknown>;
    const itemsChain = createChainMock();
    const countChain = createChainMock();
    let call = 0;
    mockDb.select = vi.fn(() => {
      call += 1;
      return call === 1 ? itemsChain : countChain;
    });
    itemsChain.offset.mockResolvedValueOnce([]);
    countChain.where.mockResolvedValueOnce([{ value: 0 }]);

    const result = await listMemories(mockDb as never, {
      ...validInput,
      limit: 10,
      offset: 20,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
    expect(itemsChain.limit).toHaveBeenCalledWith(10);
    expect(itemsChain.offset).toHaveBeenCalledWith(20);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const mockDb = { select: vi.fn() };

    const result = await listMemories(mockDb as never, {
      organizationId: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const mockDb = { select: vi.fn() };

    const result = await listMemories(mockDb as never, {
      organizationId: 'org-1',
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for limit > 200', async () => {
    const mockDb = { select: vi.fn() };

    const result = await listMemories(mockDb as never, {
      ...validInput,
      limit: 500,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    const mockDb = {} as Record<string, unknown>;
    const itemsChain = createChainMock();
    mockDb.select = vi.fn(() => itemsChain);
    itemsChain.offset.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await listMemories(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
