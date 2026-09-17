import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import {
  MAX_CONTENT_RULES,
  getContentRuleLines,
  listContentRules,
} from './list-content-rules.service.js';

interface ChainMock {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

/**
 * The chain resolves at `.limit()` — that's the last call in the builder, so it
 * stands in for awaiting the query.
 */
function createChainMock(rows: unknown[]): ChainMock {
  const chain = {} as ChainMock;
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  return chain;
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  title: 'Less salesy',
  content: 'Avoid marketing-speak; write plainly.',
  createdAt: new Date('2026-07-01T10:00:00Z'),
  ...overrides,
});

describe('listContentRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the org rules with ISO timestamps', async () => {
    const chain = createChainMock([row(), row({ id: 'rule-2' })]);

    const result = await listContentRules(chain as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0]?.createdAt).toBe('2026-07-01T10:00:00.000Z');
      expect(result.data.items[0]?.content).toBe(
        'Avoid marketing-speak; write plainly.'
      );
    }
  });

  it('caps the query so an unpruned org cannot crowd out the prompt', async () => {
    const chain = createChainMock([]);

    await listContentRules(chain as never, { organizationId: 'org-1' });

    expect(chain.limit).toHaveBeenCalledWith(MAX_CONTENT_RULES);
  });

  it('returns VALIDATION_ERROR for a missing organizationId', async () => {
    const chain = createChainMock([]);

    const result = await listContentRules(chain as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(chain.select).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the query fails', async () => {
    const chain = createChainMock([]);
    chain.limit = vi.fn(() => Promise.reject(new Error('DB down')));

    const result = await listContentRules(chain as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});

describe('getContentRuleLines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flattens rules to prompt lines', async () => {
    const chain = createChainMock([
      row({ content: 'Mention the €50 deposit.' }),
      row({ id: 'rule-2', content: 'One hashtag, not three.' }),
    ]);

    const lines = await getContentRuleLines(chain as never, 'org-1');

    expect(lines).toEqual([
      'Mention the €50 deposit.',
      'One hashtag, not three.',
    ]);
  });

  it('degrades to no rules rather than failing the generation', async () => {
    // A rules lookup that errors must not take the whole caption down with it —
    // generating without the rules is worse than generating, but far better
    // than not generating.
    const chain = createChainMock([]);
    chain.limit = vi.fn(() => Promise.reject(new Error('DB down')));

    const lines = await getContentRuleLines(chain as never, 'org-1');

    expect(lines).toEqual([]);
  });
});
