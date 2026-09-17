// Mock the heavy transitive chain before importing tool-factory. Importing
// the destructive tool reaches `tool-factory/index.ts` →
// `confirmation.ts` → `@borradh-workspace/database` (ships
// `@paralleldrive/cuid2`, ESM-only) AND `@borradh-workspace/features/assistant`
// (ships `@t3-oss/env-core`, ESM-only). swc-jest doesn't transform those
// node_modules packages. Same precedent as offers-tools.spec.ts and
// W-C02-D's hard-blocks.spec.ts. The factory's confirmation surface is
// injected via `createConfirmation` / `verifyConfirmation` on the tools
// context, so the real `db` is never called from this spec.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));

jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
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
import { getLeadStatsTool } from './get-lead-stats.tool.js';
import { listLeadsTool } from './list-leads.tool.js';
import { searchLeadsTool } from './search-leads.tool.js';
import { summariseRecentLeadsTool } from './summarise-recent-leads.tool.js';

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

describe('leads tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listLeadsTool', () => {
    it('uses the factory feature/action prefix in the tool name', () => {
      expect(listLeadsTool.name).toBe('leads_listLeads');
      expect(listLeadsTool.feature).toBe('leads');
      expect(listLeadsTool.action).toBe('listLeads');
      expect(listLeadsTool.destructive).toBe(false);
    });

    it('builds a query string from the optional filters and applies defaults', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'lead-1',
            firstName: 'Aoife',
            lastName: 'Murphy',
            email: 'a@example.com',
            phone: null,
            status: 'new',
            source: 'facebook',
            sequenceId: null,
            assignedToId: null,
            createdAt: '2026-04-22T10:00:00.000Z',
            updatedAt: '2026-04-22T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await listLeadsTool.execute(
        { status: 'new', search: 'Aoife' },
        ctx
      );

      expect(apiFetch).toHaveBeenCalledTimes(1);
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toMatch(/^leads\?/);
      expect(calledPath).toContain('status=new');
      expect(calledPath).toContain('search=Aoife');
      expect(calledPath).toContain('limit=20');
      expect(calledPath).toContain('offset=0');

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const out = result.data as {
          leads: unknown[];
          pageCount: number;
          limit: number;
        };
        expect(out.leads).toHaveLength(1);
        expect(out.pageCount).toBe(1);
        expect(out.limit).toBe(20);
      }
    });

    it('rejects out-of-range limit via Zod validation', async () => {
      const ctx = buildCtx();
      const result = await listLeadsTool.execute({ limit: 999 }, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
    });

    it('declares the leads endpoint in additionalAllowedPaths', () => {
      const paths = listLeadsTool.additionalAllowedPaths ?? [];
      expect(paths.some((re) => re.test('leads'))).toBe(true);
    });
  });

  describe('searchLeadsTool', () => {
    it('uses the leads endpoint with `search` set', async () => {
      const apiFetch = jest.fn(async () => ({ items: [] }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await searchLeadsTool.execute({ query: 'aoife', limit: 5 }, ctx);

      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toContain('search=aoife');
      expect(calledPath).toContain('limit=5');
    });

    it('rejects empty query', async () => {
      const ctx = buildCtx();
      const result = await searchLeadsTool.execute({ query: '' }, ctx);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('getLeadStatsTool', () => {
    it('hits leads/stats and returns the payload as-is', async () => {
      const stats = {
        totalLeads: 12,
        newLeads: 5,
        contactedLeads: 3,
        bookedLeads: 4,
        lostLeads: 0,
        conversionRate: 33.3,
      };
      const apiFetch = jest.fn(async () => stats);
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await getLeadStatsTool.execute({}, ctx);

      expect(apiFetch).toHaveBeenCalledWith(
        'leads/stats',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(stats);
    });
  });

  describe('summariseRecentLeadsTool', () => {
    it('hits leads/summary with timeframe + limit', async () => {
      const apiFetch = jest.fn(async () => ({
        timeframe: 'week',
        windowStart: '2026-04-18T00:00:00.000Z',
        windowEnd: '2026-04-25T00:00:00.000Z',
        totalLeads: 8,
        previousLeads: 5,
        deltaPercent: 60,
        byStatus: { new: 6, contacted: 2 },
        bySource: { facebook: 5, website: 3 },
        topLeads: [],
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await summariseRecentLeadsTool.execute(
        { timeframe: 'week', limit: 5 },
        ctx
      );

      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toContain('timeframe=week');
      expect(calledPath).toContain('limit=5');
      expect(result.ok).toBe(true);
    });
  });
});
