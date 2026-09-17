import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { MAX_CONTENT_RULES } from '../list-content-rules/list-content-rules.service.js';
import { saveContentRule } from './save-content-rule.service.js';

/**
 * These exercise the guards that run BEFORE the write. The write itself is
 * `writeKnowledgeEntry`, which owns its own tests and reaches OpenAI for an
 * embedding — mocking that module here would leak across the package's shared
 * test context (`isolate: false`), so the happy path is deliberately left to
 * that service's suite.
 */

interface ChainMock {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

function createChainMock(rows: unknown[]): ChainMock {
  const chain = {} as ChainMock;
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  return chain;
}

const existingRule = (content: string, index = 0) => ({
  id: `rule-${index}`,
  title: 'Existing',
  content,
  createdAt: new Date('2026-07-01T10:00:00Z'),
});

const validInput = {
  organizationId: 'org-1',
  title: 'Mention the deposit',
  content: 'Always mention the €50 deposit.',
};

describe('saveContentRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns VALIDATION_ERROR when the rule text is empty', async () => {
    const chain = createChainMock([]);

    const result = await saveContentRule(chain as never, {
      ...validInput,
      content: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(chain.select).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS for a rule that is only a case/space away', async () => {
    const chain = createChainMock([
      existingRule('  ALWAYS mention the €50 deposit.  '),
    ]);

    const result = await saveContentRule(chain as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  it('refuses past the cap instead of accepting a rule that would never apply', async () => {
    const chain = createChainMock(
      Array.from({ length: MAX_CONTENT_RULES }, (_, i) =>
        existingRule(`rule number ${i}`, i)
      )
    );

    const result = await saveContentRule(chain as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toContain(String(MAX_CONTENT_RULES));
    }
  });

  it('allows a distinct rule when the org is under the cap', async () => {
    // Stops before the write (see file header) — the point is that neither
    // guard rejected it.
    const chain = createChainMock([existingRule('One hashtag, not three.')]);

    const result = await saveContentRule(chain as never, validInput);

    if (!result.success) {
      expect(result.error.code).not.toBe(ErrorCodes.ALREADY_EXISTS);
      expect(result.error.code).not.toBe(ErrorCodes.CONFLICT);
    }
  });
});
