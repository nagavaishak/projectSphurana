import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

import * as database from '@borradh-workspace/database';
import * as embed from './embed.js';

// Capture every `sql\`...\`` template invocation so tests can assert what
// the WHERE clause looks like for a given `userId` arg without coupling to
// drizzle internals.
type CapturedSql = {
  strings: TemplateStringsArray;
  values: unknown[];
};

const capturedSqlCalls: CapturedSql[] = [];

import { queryKnowledge } from './query.js';

// Stub the embedding generator so tests don't hit OpenAI, and record every
// `sql\`...\`` call — both via file-local `vi.spyOn` (restored in afterEach)
// so neither leaks onto the shared worker module graph under `isolate: false`.
// The canonical `__mocks__/database.ts` re-exports the real drizzle `sql`; the
// spy swaps in a recording template tag for the duration of each test only.
// (Scope helpers `withOrgScope`/`withPublicOrgScope`/`withSystemScope` and all
// operators/tables now come free from the canonical mock — no file-local
// factory mock of the database module needed.)
let generateEmbeddingSpy: ReturnType<typeof vi.spyOn>;
let sqlSpy: ReturnType<typeof vi.spyOn>;

const mockDb = {
  execute: vi.fn(),
};

/**
 * Render a captured SQL template back to a single inspectable string by
 * interleaving the literal segments with placeholders for the bound values.
 * Bound values are substituted as `$<index>` so a string like `org-1` can't
 * trick the assertion (we check structure, not interpolated content).
 */
function renderCaptured(call: CapturedSql): string {
  const out: string[] = [];
  for (let i = 0; i < call.strings.length; i++) {
    out.push(call.strings[i]);
    if (i < call.values.length) {
      const v = call.values[i];
      // If the value is itself a captured sql sub-template, render it inline.
      if (
        v &&
        typeof v === 'object' &&
        'strings' in v &&
        Array.isArray((v as CapturedSql).strings)
      ) {
        out.push(renderCaptured(v as CapturedSql));
      } else {
        out.push(`$${i}`);
      }
    }
  }
  return out.join('');
}

/**
 * Flatten every bound value across an outer template plus any nested sub-
 * templates so cross-user / cross-org isolation assertions can scan the
 * full set without having to know how the implementation splits sql`...`
 * fragments.
 */
function flattenValues(call: CapturedSql): unknown[] {
  const out: unknown[] = [];
  for (const v of call.values) {
    if (
      v &&
      typeof v === 'object' &&
      'strings' in v &&
      Array.isArray((v as CapturedSql).strings)
    ) {
      out.push(...flattenValues(v as CapturedSql));
    } else {
      out.push(v);
    }
  }
  return out;
}

describe('queryKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateEmbeddingSpy = vi
      .spyOn(embed, 'generateEmbedding')
      .mockResolvedValue(new Array(1536).fill(0));
    sqlSpy = vi.spyOn(database, 'sql').mockImplementation(((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const captured: CapturedSql = { strings, values };
      capturedSqlCalls.push(captured);
      return captured;
    }) as never);
    capturedSqlCalls.length = 0;
    mockDb.execute.mockResolvedValue([]);
  });

  afterEach(() => {
    generateEmbeddingSpy.mockRestore();
    sqlSpy.mockRestore();
  });

  it('filters to org-wide entries (user_id IS NULL) when no userId provided', async () => {
    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
    });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);

    // The outer SELECT is the last captured call.
    const outer = capturedSqlCalls[capturedSqlCalls.length - 1];
    const rendered = renderCaptured(outer);

    // Default scope: org-wide only.
    expect(rendered).toContain('AND user_id IS NULL');
    expect(rendered).not.toContain('OR user_id =');
    expect(rendered).toContain('organization_id =');
  });

  it('filters to org-wide ∪ that user when userId provided', async () => {
    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);

    const outer = capturedSqlCalls[capturedSqlCalls.length - 1];
    const rendered = renderCaptured(outer);

    // Union scope: org-wide + that user's personal entries.
    expect(rendered).toContain('user_id IS NULL OR user_id =');
    // The userId binding lands inside the nested `userScopeFilter` sub-
    // template; flatten across the outer + inner templates to find it.
    const allBindings = flattenValues(outer);
    const userIdBindings = allBindings.filter((v) => v === 'user-1');
    expect(userIdBindings.length).toBe(1);
  });

  it('returns mapped result rows with similarity coerced to number', async () => {
    mockDb.execute.mockResolvedValueOnce([
      {
        id: 'entry-1',
        type: 'service',
        title: 'Botox',
        content: 'Botox treatment',
        metadata: null,
        confidence: 1,
        similarity: '0.87',
      },
    ]);

    const results = await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('entry-1');
    expect(results[0].similarity).toBe(0.87);
    expect(typeof results[0].similarity).toBe('number');
  });

  it('returns [] (does not throw) when the embedding call rejects', async () => {
    generateEmbeddingSpy.mockRejectedValueOnce(new Error('OpenAI rate limit'));

    const results = await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
    });

    expect(results).toEqual([]);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('cross-org isolation — only the supplied organizationId is bound', async () => {
    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    const outer = capturedSqlCalls[capturedSqlCalls.length - 1];
    const allBindings = flattenValues(outer);

    // organizationId binds exactly once; no other org id sneaks in.
    const orgBindings = allBindings.filter((v) => v === 'org-1');
    expect(orgBindings.length).toBe(1);

    const otherOrgBindings = allBindings.filter(
      (v) => typeof v === 'string' && v.startsWith('org-') && v !== 'org-1'
    );
    expect(otherOrgBindings.length).toBe(0);
  });

  it('cross-user isolation — different user ids do not leak across calls', async () => {
    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
      userId: 'user-A',
    });
    const firstAll = flattenValues(
      capturedSqlCalls[capturedSqlCalls.length - 1]
    );
    expect(firstAll).toContain('user-A');
    expect(firstAll).not.toContain('user-B');

    capturedSqlCalls.length = 0;

    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
      userId: 'user-B',
    });
    const secondAll = flattenValues(
      capturedSqlCalls[capturedSqlCalls.length - 1]
    );
    expect(secondAll).toContain('user-B');
    expect(secondAll).not.toContain('user-A');
  });

  it('respects topK override', async () => {
    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
      topK: 5,
    });

    const outer = capturedSqlCalls[capturedSqlCalls.length - 1];
    expect(outer.values).toContain(5);
  });

  it('defaults topK to 10 when not provided', async () => {
    await queryKnowledge(mockDb as never, {
      query: 'test',
      organizationId: 'org-1',
    });

    const outer = capturedSqlCalls[capturedSqlCalls.length - 1];
    expect(outer.values).toContain(10);
  });
});
