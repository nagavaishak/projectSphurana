// Mock the heavy transitive chain before importing tool-factory. Same
// precedent as leads-tools.spec.ts / customer-conversations-tools.spec.ts /
// W-C02-D's hard-blocks.spec.ts — features/database barrels pull cuid2 +
// t3-env (ESM-only) which swc-jest doesn't transform. The remember tool
// pulls `writeKnowledgeEntry` from features; we mock it as a jest fn so
// the test never touches a real DB or OpenAI embeddings.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
  // The remember tool wraps its admin check in `withSystemScope` so the RLS
  // interceptor sees a system-scoped connection. In tests we just invoke the
  // callback with the mocked db so the wrapped logic runs unchanged.
  withSystemScope: (fn: (conn: unknown) => unknown, { db }: { db: unknown }) =>
    fn(db),
}));

const mockWriteKnowledgeEntry = jest.fn();
// jest hoists `jest.mock` to the top of the file, so the factory must not
// reference the test file's `const mockWriteKnowledgeEntry` directly —
// only inside a function body that runs *after* module init. The
// `(...args) => mockWriteKnowledgeEntry(...args)` indirection mirrors how
// `customer-conversations-tools.spec.ts` mocks `messages.create` inside
// an arrow body.
jest.mock('@borradh-workspace/features/assistant', () => ({
  writeKnowledgeEntry: (...args: unknown[]) => mockWriteKnowledgeEntry(...args),
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

const mockCheckAdminAccess = jest.fn();
jest.mock('@borradh-workspace/features/organizations', () => ({
  checkAdminAccess: (...args: unknown[]) => mockCheckAdminAccess(...args),
}));

jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  trackedResult: <T>(_name: string, fn: () => Promise<T>) => fn(),
}));

import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { rememberTool } from './remember.tool.js';

interface CtxOverrides {
  organizationId?: string;
  userId?: string;
  conversationId?: string;
  callCounter?: { count: number; max: number };
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = jest.fn() as never;
  return {
    organizationId: overrides.organizationId ?? 'org-1',
    userId: overrides.userId ?? 'user-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch) as never,
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation: jest.fn() as never,
    verifyConfirmation: jest.fn() as never,
  };
}

describe('rememberTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteKnowledgeEntry.mockReset();
    mockCheckAdminAccess.mockReset();
    // Default: admin (only matters for scope: 'organization' tests). Per-test
    // overrides flip this to a non-admin to exercise the new gate.
    mockCheckAdminAccess.mockResolvedValue({
      success: true,
      data: { hasAccess: true },
    });
  });

  it('uses the meta_remember factory tool name', () => {
    expect(rememberTool.name).toBe('meta_remember');
    expect(rememberTool.feature).toBe('meta');
    expect(rememberTool.action).toBe('remember');
    expect(rememberTool.destructive).toBe(false);
  });

  it('does NOT declare hard-blocks on the config — it enforces them inline', () => {
    // The factory now auto-runs declared hard-blocks for non-destructive tools
    // too, but this tool wants its own softer "rephrase" handling, so it runs
    // the validators manually inside execute instead of declaring them here.
    // The two `returns hard_block_violation when …` tests below cover the
    // actual enforcement.
    expect(rememberTool.hardBlocks ?? []).toEqual([]);
  });

  it('writes a personal memory by default (userId = ctx.userId)', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-1' },
    });

    const ctx = buildCtx({ userId: 'user-42', organizationId: 'org-99' });
    const result = await rememberTool.execute(
      { content: 'Prefers warm color palettes for video and image work.' },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(mockWriteKnowledgeEntry).toHaveBeenCalledTimes(1);
    const [, writeArg] = mockWriteKnowledgeEntry.mock.calls[0] as [
      unknown,
      {
        organizationId: string;
        userId: string | null;
        type: string;
        title: string;
        content: string;
        source: string;
      },
    ];
    expect(writeArg.organizationId).toBe('org-99');
    expect(writeArg.userId).toBe('user-42');
    expect(writeArg.type).toBe('preference');
    expect(writeArg.source).toBe('manual');
    expect(writeArg.title.startsWith('Memory: ')).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.saved).toBe(true);
      expect(result.data.scope).toBe('personal');
      expect(result.data.knowledgeEntryId).toBe('ke-1');
      expect(result.data.message).toContain('next time we talk');
    }
  });

  it('writes an org-wide memory when scope: "organization" (userId = null)', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-2' },
    });

    const ctx = buildCtx({ userId: 'user-42', organizationId: 'org-99' });
    const result = await rememberTool.execute(
      {
        content: "We don't run paid ads on Sundays.",
        scope: 'organization',
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const [, writeArg] = mockWriteKnowledgeEntry.mock.calls[0] as [
      unknown,
      { organizationId: string; userId: string | null; title: string },
    ];
    expect(writeArg.organizationId).toBe('org-99');
    expect(writeArg.userId).toBeNull();
    expect(writeArg.title.startsWith('Team memory: ')).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.scope).toBe('organization');
      expect(result.data.message).toContain('team');
    }
  });

  it('rejects org-scope writes from a non-admin caller (no DB write)', async () => {
    mockCheckAdminAccess.mockResolvedValueOnce({
      success: true,
      data: { hasAccess: false },
    });

    const ctx = buildCtx({ userId: 'member-1', organizationId: 'org-99' });
    const result = await rememberTool.execute(
      {
        content: "We don't run paid ads on Sundays.",
        scope: 'organization',
      },
      ctx
    );

    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
    expect(result.ok).toBe(true); // factory wraps tool data successfully
    if (result.ok && result.data) {
      expect(result.data.saved).toBe(false);
      expect(result.data.scope).toBe('organization');
      expect(result.data.message).toMatch(/admin/i);
    }
    expect(mockCheckAdminAccess).toHaveBeenCalledWith(expect.anything(), {
      userId: 'member-1',
      organizationId: 'org-99',
    });
  });

  it('does not call checkAdminAccess for personal-scope writes', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-personal' },
    });

    const ctx = buildCtx({ userId: 'user-42', organizationId: 'org-99' });
    await rememberTool.execute(
      { content: 'Prefers warm color palettes for video and image work.' },
      ctx
    );

    expect(mockCheckAdminAccess).not.toHaveBeenCalled();
  });

  it('binds the requesting user as `savedBy` in metadata regardless of scope', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-3' },
    });

    const ctx = buildCtx({ userId: 'user-42', organizationId: 'org-99' });
    await rememberTool.execute(
      {
        content: "We don't run paid ads on Sundays.",
        scope: 'organization',
      },
      ctx
    );

    const [, writeArg] = mockWriteKnowledgeEntry.mock.calls[0] as [
      unknown,
      { metadata: Record<string, unknown> },
    ];
    expect(writeArg.metadata).toEqual({
      savedBy: 'user-42',
      scope: 'organization',
      conversationId: 'conv-1',
    });
  });

  it('returns hard_block_violation when noFabricatedResultClaims fires', async () => {
    const failingValidator = jest.fn(async () => ({
      pass: false,
      code: 'noFabricatedResultClaims',
      message: 'Result claims must be conservative.',
    })) as never;
    const ctx = buildCtx({ runHardBlocks: failingValidator });

    const result = await rememberTool.execute(
      { content: 'Cure rate is 99% — best in the world.' },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.data?.saved).toBe(false);
      expect(result.data?.hardBlock?.code).toBe('noFabricatedResultClaims');
      expect(result.presentation?.type).toBe('hard_block_violation');
    }
  });

  it('returns hard_block_violation when noPomBrandNamesInAdCopy fires', async () => {
    // POM list is empty for v3 launch (D-7), so the validator passes by
    // default. Simulate a populated list firing on a brand name.
    const failingValidator = jest.fn(async () => ({
      pass: false,
      code: 'noPomBrandNamesInAdCopy',
      message: "Ad copy can't name a prescription-only medicine.",
    })) as never;
    const ctx = buildCtx({ runHardBlocks: failingValidator });

    const result = await rememberTool.execute(
      { content: 'We use Aqualyx for fat dissolving.' },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.data?.saved).toBe(false);
      expect(result.data?.hardBlock?.code).toBe('noPomBrandNamesInAdCopy');
    }
  });

  it('rejects content shorter than 8 chars via Zod', async () => {
    const ctx = buildCtx();
    const result = await rememberTool.execute({ content: 'short' }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('rejects content longer than 500 chars via Zod', async () => {
    const ctx = buildCtx();
    const result = await rememberTool.execute(
      { content: 'x'.repeat(501) },
      ctx
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('rejects an invalid scope value via Zod', async () => {
    const ctx = buildCtx();
    const result = await rememberTool.execute(
      {
        content: 'Prefers warm color palettes for video and image work.',
        scope: 'global' as never,
      },
      ctx
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('cross-org isolation: the write is scoped to ctx.organizationId only', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-orgA' },
    });
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-orgB' },
    });

    await rememberTool.execute(
      { content: 'Org A specific preference here.' },
      buildCtx({ organizationId: 'org-A' })
    );
    await rememberTool.execute(
      { content: 'Org B specific preference here.' },
      buildCtx({ organizationId: 'org-B' })
    );

    const orgArgs = mockWriteKnowledgeEntry.mock.calls.map(
      (c) => (c[1] as { organizationId: string }).organizationId
    );
    expect(orgArgs).toEqual(['org-A', 'org-B']);
  });

  it('truncates the title prefix when content exceeds 60 chars', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-long' },
    });

    const longContent =
      'I prefer warm color palettes — autumns and golds — for everything we ship';
    const ctx = buildCtx();
    await rememberTool.execute({ content: longContent }, ctx);

    const [, writeArg] = mockWriteKnowledgeEntry.mock.calls[0] as [
      unknown,
      { title: string; content: string },
    ];
    expect(writeArg.content).toBe(longContent);
    expect(writeArg.title.endsWith('…')).toBe(true);
    expect(writeArg.title.length).toBeLessThan(
      longContent.length + 'Memory: '.length
    );
  });

  it('throws (factory sanitizes) when writeKnowledgeEntry returns failure', async () => {
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'DB connection lost' },
    });

    const ctx = buildCtx();
    const result = await rememberTool.execute(
      { content: 'Prefers warm color palettes for video and image work.' },
      ctx
    );

    // The factory wraps thrown errors into TOOL_EXECUTION_ERROR results.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    }
  });
});
