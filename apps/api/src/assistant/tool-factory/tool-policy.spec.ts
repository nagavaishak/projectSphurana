import { z } from 'zod';
import { defineTool } from './define-tool.js';
import type { AssistantToolsContext } from './types.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

/**
 * The tool-side counterpart of `RoleGuard`.
 *
 * `ToolDefinition.policy` was added so Gate 3 could COUNT who may call a tool.
 * Counting is not enforcing, and the difference is a privilege escalation:
 * `PUT /meta-campaigns/:metaCampaignId` carries `@RequireRole('admin')`, and
 * the only reason Claire respects it today is that the port goes through the
 * authenticated loopback. Remove that hop with nothing checking `policy` and
 * any member can change ad budgets by asking.
 *
 * These tests pin the check itself. The role comes from `ctx.callerRole`,
 * resolved by `resolveCallerRole` from the same `member` row `RoleGuard`
 * reads — one source of truth, so the HTTP path and the tool path cannot
 * disagree about who someone is.
 */

let executed = false;

const adminOnlyTool = defineTool<{ value: number }, { ok: true }>({
  feature: 'test',
  action: 'adminOnly',
  description: 'test tool requiring admin',
  inputSchema: z.object({ value: z.number() }),
  destructive: false,
  policy: 'admin',
  execute: async () => {
    executed = true;
    return { data: { ok: true as const } };
  },
});

const openTool = defineTool<Record<string, never>, { ok: true }>({
  feature: 'test',
  action: 'open',
  description: 'test tool open to any member',
  inputSchema: z.object({}),
  destructive: false,
  policy: 'any',
  execute: async () => {
    executed = true;
    return { data: { ok: true as const } };
  },
});

function ctx(
  callerRole?: AssistantToolsContext['callerRole']
): AssistantToolsContext {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    callerRole,
    conversationId: 'conv-1',
    apiFetch: jest.fn() as never,
    buildApiFetch: jest.fn() as never,
    ports: {} as never,
    reportIssue: jest.fn(),
    callCounter: { count: 0, max: 50 },
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation: jest.fn() as never,
    verifyConfirmation: jest.fn() as never,
  };
}

describe('tool policy enforcement', () => {
  beforeEach(() => {
    executed = false;
  });

  it('refuses a member when the tool requires admin', async () => {
    const result = await adminOnlyTool.execute({ value: 1 }, ctx('member'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    expect(executed).toBe(false);
  });

  it('allows an admin', async () => {
    const result = await adminOnlyTool.execute({ value: 1 }, ctx('admin'));
    expect(result.ok).toBe(true);
    expect(executed).toBe(true);
  });

  it('allows an owner (role hierarchy, not equality)', async () => {
    const result = await adminOnlyTool.execute({ value: 1 }, ctx('owner'));
    expect(result.ok).toBe(true);
    expect(executed).toBe(true);
  });

  it('FAILS CLOSED when the caller role could not be resolved', async () => {
    // The load-bearing case. An unresolvable role must not read as "no
    // restriction" — that is precisely how a role gate evaporates silently
    // when a construction site forgets to resolve it.
    const result = await adminOnlyTool.execute({ value: 1 }, ctx(undefined));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    expect(executed).toBe(false);
  });

  it('checks policy BEFORE input validation', async () => {
    // An unauthorized caller must not be able to probe a capability's input
    // shape by sending garbage and reading the validation error back.
    const result = await adminOnlyTool.execute(
      { value: 'not-a-number' },
      ctx('member')
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('FORBIDDEN');
      expect(result.code).not.toBe('VALIDATION_ERROR');
    }
  });

  it("does not gate a tool declaring policy 'any', even with no role", async () => {
    const result = await openTool.execute({}, ctx(undefined));
    expect(result.ok).toBe(true);
    expect(executed).toBe(true);
  });
});
