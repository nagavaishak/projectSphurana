import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

import * as database from '@borradh-workspace/database';
import * as embed from '../../knowledge/embed.js';

// `sql` is captured as a recording template tag — every call records the
// strings + interpolated values so we can assert that both `organization_id`
// and `user_id` flow into the INSERT correctly. The shape mirrors the
// pattern in `query.test.ts` (which also covers cross-org / cross-user
// isolation against the same column).
const sqlCalls: { strings: readonly string[]; values: unknown[] }[] = [];

import { ErrorCodes } from '../../../shared/index.js';
import { writeKnowledgeEntry } from './write-knowledge-entry.service.js';

// Both the embedding generator and the `sql` recorder are installed via
// file-local `vi.spyOn` (restored in afterEach) so neither leaks onto the
// shared worker module graph under `isolate: false`. The canonical
// `__mocks__/database.ts` supplies the WHOLE barrel — `knowledgeEntryTypeValues`
// and every other schema export, plus the scope helpers — for free via its
// `export * from schema`, so no file-local factory mock of the database module
// is needed. The spy only swaps in the recording template tag per test.
let generateEmbeddingSpy: ReturnType<typeof vi.spyOn>;
let sqlSpy: ReturnType<typeof vi.spyOn>;

const mockDb = {
  execute: vi.fn(),
};

const validPersonalInput = {
  organizationId: 'org-1',
  userId: 'user-1',
  type: 'preference' as const,
  title: 'Memory: prefers warm color palettes',
  content: 'Prefers warm color palettes for video and image work.',
};

describe('writeKnowledgeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
    generateEmbeddingSpy = vi
      .spyOn(embed, 'generateEmbedding')
      .mockResolvedValue(new Array(1536).fill(0.1));
    sqlSpy = vi.spyOn(database, 'sql').mockImplementation(((
      strings: readonly string[],
      ...values: unknown[]
    ) => {
      sqlCalls.push({ strings, values });
      return { __sql: true, strings, values };
    }) as never);
    mockDb.execute.mockResolvedValue([{ id: 'ke-abc' }]);
  });

  afterEach(() => {
    generateEmbeddingSpy.mockRestore();
    sqlSpy.mockRestore();
  });

  it('inserts a personal knowledge entry and returns the new id', async () => {
    const result = await writeKnowledgeEntry(
      mockDb as never,
      validPersonalInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBe('ke-abc');
    }
    expect(generateEmbeddingSpy).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('passes both organizationId and userId into the INSERT (personal scope)', async () => {
    await writeKnowledgeEntry(mockDb as never, validPersonalInput);

    const allValues = sqlCalls.flatMap((c) => c.values);
    expect(allValues).toContain('org-1');
    expect(allValues).toContain('user-1');
    expect(allValues).toContain('preference');
  });

  it('writes an org-wide entry when userId is null', async () => {
    await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      userId: null,
    });

    const allValues = sqlCalls.flatMap((c) => c.values);
    expect(allValues).toContain('org-1');
    // null userId flows into the SQL template as a literal null binding.
    expect(allValues).toContain(null);
    // And user-1 must NOT appear since it wasn't supplied.
    expect(allValues).not.toContain('user-1');
  });

  it('respects cross-org isolation by binding the supplied organizationId verbatim', async () => {
    await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      organizationId: 'org-A',
    });
    await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      organizationId: 'org-B',
    });

    // Each call binds its own org. Cross-org data leak is impossible because
    // the INSERT names the org explicitly — the schema window's invariant
    // that every row carries an `organization_id` is preserved.
    const orgValuesPerCall = sqlCalls.map((c) =>
      c.values.find((v) => v === 'org-A' || v === 'org-B')
    );
    expect(orgValuesPerCall).toEqual(['org-A', 'org-B']);
  });

  it('returns VALIDATION_ERROR for empty content', async () => {
    const result = await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      content: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(generateEmbeddingSpy).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when content exceeds 2000 chars', async () => {
    const result = await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      content: 'x'.repeat(2001),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for an unknown knowledge type', async () => {
    const result = await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      // intentional bad cast — the schema enum keeps callers honest at TS
      // time; runtime check covers untyped JS callers and mistyped mocks.
      type: 'not_a_real_type' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns EXTERNAL_SERVICE_ERROR when the embedding call fails', async () => {
    generateEmbeddingSpy.mockRejectedValueOnce(new Error('OpenAI down'));

    const result = await writeKnowledgeEntry(
      mockDb as never,
      validPersonalInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await writeKnowledgeEntry(
      mockDb as never,
      validPersonalInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns INTERNAL_ERROR when the INSERT returns no row', async () => {
    mockDb.execute.mockResolvedValueOnce([]);

    const result = await writeKnowledgeEntry(
      mockDb as never,
      validPersonalInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('serialises optional metadata to JSON before binding', async () => {
    await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      metadata: { source: 'remember-tool', conversationId: 'conv-9' },
    });

    const allValues = sqlCalls.flatMap((c) => c.values);
    const metadataValue = allValues.find(
      (v) => typeof v === 'string' && v.includes('"source":"remember-tool"')
    );
    expect(metadataValue).toBeDefined();
  });

  it('binds the type, source, confidence into the INSERT', async () => {
    await writeKnowledgeEntry(mockDb as never, {
      ...validPersonalInput,
      source: 'manual',
      confidence: 0.95,
    });

    const allValues = sqlCalls.flatMap((c) => c.values);
    expect(allValues).toContain('preference');
    expect(allValues).toContain('manual');
    expect(allValues).toContain(0.95);
  });
});
