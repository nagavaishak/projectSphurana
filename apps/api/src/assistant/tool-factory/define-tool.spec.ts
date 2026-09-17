import { logError, logWarning } from '@borradh-workspace/observability';
import { z } from 'zod';
import { ApiFetchError } from './api-fetch.js';
import { defineTool } from './define-tool.js';
import {
  type ToolFailureTracker,
  createToolFailureTracker,
} from './failure-tracker.js';
import { createToolCallCounter } from './tool-call-limit.js';
import type {
  AssistantToolsContext,
  HardBlockResult,
  HardBlockRunner,
} from './types.js';

// Module-level mocks
jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

interface MockContextOverrides {
  organizationId?: string;
  conversationId?: string;
  callCounter?: { count: number; max: number };
  failureTracker?: ToolFailureTracker;
  runHardBlocks?: HardBlockRunner;
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
}

function buildCtx(overrides: MockContextOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: overrides.organizationId ?? 'org-1',
    userId: 'user-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    ...(overrides.failureTracker
      ? { failureTracker: overrides.failureTracker }
      : {}),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
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

describe('defineTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('construction-time guards', () => {
    it('throws when feature is not kebab-camelCase compatible', () => {
      expect(() =>
        defineTool({
          feature: 'BadFeature',
          action: 'doThing',
          description: 'd',
          inputSchema: z.object({}),
          destructive: false,
          execute: async () => ({}),
        })
      ).toThrow(/feature/);
    });

    it('throws when action contains spaces', () => {
      expect(() =>
        defineTool({
          feature: 'meta-ads',
          action: 'do thing',
          description: 'd',
          inputSchema: z.object({}),
          destructive: false,
          execute: async () => ({}),
        })
      ).toThrow(/action/);
    });

    it('throws when destructive=true but destructiveAction missing', () => {
      expect(() =>
        defineTool({
          feature: 'meta-ads',
          action: 'pauseAd',
          description: 'd',
          inputSchema: z.object({ adId: z.string() }),
          destructive: true,
          summarizeForConfirmation: async () => ({ resourceId: 'x' }),
          execute: async () => ({}),
        })
      ).toThrow(/destructiveAction/);
    });

    it('throws when destructive=true but summarizeForConfirmation missing', () => {
      expect(() =>
        defineTool({
          feature: 'meta-ads',
          action: 'pauseAd',
          description: 'd',
          inputSchema: z.object({ adId: z.string() }),
          destructive: true,
          destructiveAction: 'pause_campaign',
          execute: async () => ({}),
        })
      ).toThrow(/summarizeForConfirmation/);
    });
  });

  describe('Anthropic tool shape', () => {
    it('produces { name, description, input_schema } from the Zod schema', () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'listCampaigns',
        description: 'List Meta campaigns.',
        inputSchema: z.object({
          status: z.enum(['ACTIVE', 'PAUSED']).optional(),
        }),
        destructive: false,
        execute: async () => ({}),
      });

      const def = tool.toAnthropicDefinition();
      expect(def.name).toBe('meta_ads_listCampaigns');
      expect(def.description).toBe('List Meta campaigns.');
      expect(def.input_schema).toMatchObject({
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
        },
      });
      // No $schema meta-field — Anthropic doesn't want it.
      expect(def.input_schema.$schema).toBeUndefined();
    });

    it('throws at construction when inputSchema is a top-level discriminated union', () => {
      // Repro for the meta_remember chat-stream crash: Zod's
      // `z.discriminatedUnion` compiles to `{ oneOf: [...] }` at the root,
      // and Anthropic explicitly rejects that with:
      //   "input_schema does not support oneOf, allOf, or anyOf at the top level"
      // Catching it at construction means a misconfigured tool fails boot
      // (loud, immediate) instead of every chat turn that happens to load it
      // (silent until the model picks it).
      expect(() =>
        defineTool({
          feature: 'org-defaults',
          action: 'setOrgDefault',
          description: 'Set one defaultable key.',
          inputSchema: z.discriminatedUnion('key', [
            z.object({
              key: z.literal('budget'),
              value: z.number().int().positive(),
            }),
            z.object({
              key: z.literal('brand'),
              value: z.string().min(1),
            }),
          ]),
          destructive: false,
          execute: async () => ({}),
        })
      ).toThrow(/oneOf, allOf, or anyOf at the top level/i);
    });
  });

  describe('input validation', () => {
    it('returns VALIDATION_ERROR when input fails Zod parse', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'getAd',
        description: 'd',
        inputSchema: z.object({ adId: z.string().min(1) }),
        destructive: false,
        execute: async () => ({ data: { id: 'x' } }),
      });

      const result = await tool.execute({ adId: '' }, buildCtx());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns VALIDATION_ERROR when input is the wrong shape entirely', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'getAd',
        description: 'd',
        inputSchema: z.object({ adId: z.string() }),
        destructive: false,
        execute: async () => ({}),
      });
      const result = await tool.execute({ wrongField: 'x' }, buildCtx());
      expect(result.ok).toBe(false);
    });
  });

  describe('tool-call counter', () => {
    it('increments the per-turn counter on each call', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'noop',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => ({}),
      });
      const ctx = buildCtx();
      await tool.execute({}, ctx);
      await tool.execute({}, ctx);
      await tool.execute({}, ctx);
      expect(ctx.callCounter.count).toBe(3);
    });

    it('returns TOOL_CALL_LIMIT_EXCEEDED when counter is exhausted', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'noop',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => ({}),
      });
      const ctx = buildCtx({ callCounter: { count: 50, max: 50 } });
      const result = await tool.execute({}, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TOOL_CALL_LIMIT_EXCEEDED');
      }
      // Counter should NOT increment past the limit.
      expect(ctx.callCounter.count).toBe(50);
    });
  });

  describe('non-destructive happy path', () => {
    it('runs execute and returns ok+data', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'listCampaigns',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => ({ data: { items: [{ id: '1' }] } }),
      });
      const result = await tool.execute({}, buildCtx());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ items: [{ id: '1' }] });
      }
    });

    it('catches thrown errors and returns sanitized message', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'listCampaigns',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => {
          throw new Error(
            'failed query: select id from users where password = secret123'
          );
        },
      });
      const result = await tool.execute({}, buildCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Sanitized — should NOT contain the raw SQL fragment.
        expect(result.error).not.toMatch(/select|password/i);
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
      }
      // A non-ApiFetchError fault is still captured to Sentry.
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('does NOT log a 4xx ApiFetchError to Sentry (expected tool outcome)', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'listCampaigns',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => {
          throw new ApiFetchError('Authentication required', 401);
        },
      });
      const result = await tool.execute({}, buildCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Authentication required');
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
      }
      // 4xx is an expected client-facing condition — no Sentry noise.
      expect(logError).not.toHaveBeenCalled();
    });

    it('DOES log a 5xx ApiFetchError to Sentry (genuine server fault)', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'listCampaigns',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => {
          throw new ApiFetchError(
            'Something went wrong. Please try again.',
            500
          );
        },
      });
      const result = await tool.execute({}, buildCtx());
      expect(result.ok).toBe(false);
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });

  describe('destructive flow — first call (no token)', () => {
    function makeDestructiveTool(opts?: {
      hardBlocks?: string[];
      executeFn?: () => Promise<{
        data?: unknown;
        presentation?: { type: string };
      }>;
    }) {
      return defineTool({
        feature: 'meta-ads',
        action: 'launchAd',
        description: 'd',
        inputSchema: z.object({
          adId: z.string(),
          confirmationToken: z.string().optional(),
        }),
        destructive: true,
        destructiveAction: 'launch_ad',
        hardBlocks: opts?.hardBlocks ?? [],
        summarizeForConfirmation: async (input) => ({
          resourceId: (input as { adId: string }).adId,
          title: 'Launch ad',
          fields: [{ label: 'Ad', value: (input as { adId: string }).adId }],
          payload: { adId: (input as { adId: string }).adId },
        }),
        execute:
          opts?.executeFn ?? (async () => ({ data: { launched: true } })),
      });
    }

    it('issues a confirmation token and DOES NOT run execute', async () => {
      const executeSpy = jest.fn(async () => ({ data: { launched: true } }));
      const tool = makeDestructiveTool({ executeFn: executeSpy });
      const createConfirmation = jest.fn(async () => ({
        id: 'token-zzz',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({ createConfirmation: createConfirmation as never });

      const result = await tool.execute({ adId: 'ad-1' }, ctx);

      expect(executeSpy).not.toHaveBeenCalled();
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'launch_ad',
        resourceId: 'ad-1',
        payload: { adId: 'ad-1' },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('token-zzz');
        expect(result.presentation.action).toBe('launch_ad');
        expect(result.presentation.resourceId).toBe('ad-1');
        expect(result.presentation.executeToolName).toBe('meta_ads_launchAd');
      }
    });

    it('runs the hard-block runner before issuing a token', async () => {
      const runHardBlocks = jest.fn(async () => ({ pass: true })) as never;
      const tool = makeDestructiveTool({
        hardBlocks: ['noLiveCampaignChangeDuringLearningPhase'],
      });
      const ctx = buildCtx({ runHardBlocks });

      await tool.execute({ adId: 'ad-1' }, ctx);

      expect(runHardBlocks).toHaveBeenCalledWith(
        ['noLiveCampaignChangeDuringLearningPhase'],
        { adId: 'ad-1' },
        expect.any(Object)
      );
    });

    it('returns hard_block_violation when a validator fails (no token issued)', async () => {
      const runHardBlocks: HardBlockRunner = async () => ({
        pass: false,
        code: 'LEARNING_PHASE_LOCK',
        message: 'Cannot modify a campaign in its learning phase.',
      });
      const tool = makeDestructiveTool({
        hardBlocks: ['noLiveCampaignChangeDuringLearningPhase'],
      });
      const createConfirmation = jest.fn();
      const ctx = buildCtx({
        runHardBlocks,
        createConfirmation: createConfirmation as never,
      });

      const result = await tool.execute({ adId: 'ad-1' }, ctx);

      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok && result.presentation?.type === 'hard_block_violation') {
        expect(result.code).toBe('LEARNING_PHASE_LOCK');
        expect(result.presentation.message).toMatch(/learning phase/);
      }
    });
  });

  describe('destructive flow — second call (with token)', () => {
    function makeDestructiveTool(
      executeFn?: () => Promise<{ data?: unknown }>
    ) {
      return defineTool({
        feature: 'meta-ads',
        action: 'launchAd',
        description: 'd',
        inputSchema: z.object({
          adId: z.string(),
          confirmationToken: z.string().optional(),
        }),
        destructive: true,
        destructiveAction: 'launch_ad',
        summarizeForConfirmation: async () => ({ resourceId: 'unused' }),
        execute: executeFn ?? (async () => ({ data: { launched: true } })),
      });
    }

    it('verifies the token, marks consumed, and runs execute', async () => {
      const executeSpy = jest.fn(async () => ({ data: { launched: true } }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { adId: 'ad-1' },
      }));
      const tool = makeDestructiveTool(executeSpy);
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await tool.execute(
        { adId: 'ad-1', confirmationToken: 'token-zzz' },
        ctx
      );

      expect(verifyConfirmation).toHaveBeenCalledWith({
        token: 'token-zzz',
        action: 'launch_ad',
        resourceId: 'ad-1',
      });
      expect(executeSpy).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('returns confirmation_expired when token is invalid', async () => {
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'expired' as const,
      }));
      const tool = makeDestructiveTool();
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await tool.execute(
        { adId: 'ad-1', confirmationToken: 'token-old' },
        ctx
      );

      expect(result.ok).toBe(false);
      if (!result.ok && result.presentation?.type === 'confirmation_expired') {
        expect(result.presentation.reason).toBe('expired');
        expect(result.code).toBe('CONFIRMATION_INVALID');
      }
    });

    it('verifies with resourceId omitted when no id-shaped field is on input', async () => {
      // Create-style tools whose resource doesn't exist yet (e.g.
      // `create_lead`) can't echo back a natural resourceId. The factory
      // falls through to `verifyConfirmation` with `resourceId: undefined`
      // and lets the service bind on (action + payload) instead.
      const executeSpy = jest.fn(async () => ({ data: { ok: true } }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { someField: 'foo' },
      }));
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'launchAd',
        description: 'd',
        inputSchema: z.object({
          someField: z.string(),
          confirmationToken: z.string().optional(),
        }),
        destructive: true,
        destructiveAction: 'launch_ad',
        summarizeForConfirmation: async () => ({
          resourceId: 'fabricated',
          payload: { someField: 'foo' },
        }),
        execute: executeSpy as never,
      });

      const result = await tool.execute(
        { someField: 'foo', confirmationToken: 'token-zzz' },
        buildCtx({ verifyConfirmation: verifyConfirmation as never })
      );

      expect(verifyConfirmation).toHaveBeenCalledWith({
        token: 'token-zzz',
        action: 'launch_ad',
        resourceId: undefined,
      });
      expect(executeSpy).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('rejects when the second-call input contradicts a confirmed payload field', async () => {
      const executeSpy = jest.fn(async () => ({ data: { launched: true } }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { adId: 'ad-1', dailyBudget: 50 },
      }));
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'updateBudget',
        description: 'd',
        inputSchema: z.object({
          adId: z.string(),
          dailyBudget: z.number().optional(),
          confirmationToken: z.string().optional(),
        }),
        destructive: true,
        destructiveAction: 'update_budget',
        summarizeForConfirmation: async (input) => {
          const i = input as { adId: string; dailyBudget?: number };
          return {
            resourceId: i.adId,
            payload: { adId: i.adId, dailyBudget: i.dailyBudget ?? 0 },
          };
        },
        execute: executeSpy as never,
      });
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
      });

      // Operator confirmed dailyBudget=50; model echoes back 9999.
      const result = await tool.execute(
        { adId: 'ad-1', dailyBudget: 9999, confirmationToken: 'token-zzz' },
        ctx
      );

      expect(executeSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONFIRMATION_PAYLOAD_MISMATCH');
        if (result.presentation?.type === 'confirmation_expired') {
          expect(result.presentation.reason).toBe('mismatch');
        }
      }
    });

    it('allows the second-call input to carry extra fields not present in the confirmed payload', async () => {
      // Some destructive tools deliberately bind only a subset of inputs in
      // their summarize payload (e.g. book-appointment locks the time slot
      // but not the title/description). The model must be able to pass the
      // unbound fields on the second call without triggering a mismatch.
      const executeSpy = jest.fn(async () => ({ data: { booked: true } }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { leadId: 'l-1', startDate: '2026-05-10' },
      }));
      const tool = defineTool({
        feature: 'appointments',
        action: 'bookAppointment',
        description: 'd',
        inputSchema: z.object({
          leadId: z.string(),
          startDate: z.string(),
          title: z.string().optional(),
          confirmationToken: z.string().optional(),
        }),
        destructive: true,
        destructiveAction: 'book_appointment',
        summarizeForConfirmation: async (input) => {
          const i = input as { leadId: string; startDate: string };
          return {
            resourceId: i.leadId,
            payload: { leadId: i.leadId, startDate: i.startDate },
          };
        },
        execute: executeSpy as never,
      });
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await tool.execute(
        {
          leadId: 'l-1',
          startDate: '2026-05-10',
          title: 'Consult', // not in payload — must still be allowed
          confirmationToken: 'token-zzz',
        },
        ctx
      );

      expect(executeSpy).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('falls back to resourceId-only binding when stored payload is null', async () => {
      const executeSpy = jest.fn(async () => ({ data: { launched: true } }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const tool = makeDestructiveTool(executeSpy);
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await tool.execute(
        { adId: 'ad-1', confirmationToken: 'token-zzz' },
        ctx
      );

      expect(executeSpy).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('rejects mismatch between echoed token and a different concurrent token (verification reports mismatch)', async () => {
      // The server-side service detects this — factory just propagates.
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'mismatch' as const,
      }));
      const tool = makeDestructiveTool();
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await tool.execute(
        { adId: 'ad-1', confirmationToken: 'token-from-a-different-call' },
        ctx
      );

      expect(result.ok).toBe(false);
      if (!result.ok && result.presentation?.type === 'confirmation_expired') {
        expect(result.presentation.reason).toBe('mismatch');
      }
    });
  });

  describe('per-tool path-whitelist extension', () => {
    it('uses the context buildApiFetch when additionalAllowedPaths is set', async () => {
      const baseFetch = jest.fn(async () => ({})) as never;
      const extendedFetch = jest.fn(async () => ({ extended: true })) as never;
      const buildApiFetch = jest.fn(() => extendedFetch);
      const ctx = buildCtx({
        apiFetch: baseFetch,
        buildApiFetch: buildApiFetch as never,
      });

      const tool = defineTool({
        feature: 'custom',
        action: 'doStuff',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        additionalAllowedPaths: [/^custom-endpoint$/],
        execute: async (_input, ctxFromExecute) => {
          const out = await ctxFromExecute.apiFetch('custom-endpoint');
          return { data: out };
        },
      });

      const result = await tool.execute({}, ctx);

      expect(buildApiFetch).toHaveBeenCalledWith([/^custom-endpoint$/]);
      expect(extendedFetch).toHaveBeenCalledWith('custom-endpoint');
      if (result.ok) {
        expect(result.data).toEqual({ extended: true });
      }
    });

    it('does NOT call buildApiFetch when no additionalAllowedPaths are declared', async () => {
      const buildApiFetch = jest.fn();
      const ctx = buildCtx({ buildApiFetch: buildApiFetch as never });

      const tool = defineTool({
        feature: 'custom',
        action: 'doStuff',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => ({}),
      });

      await tool.execute({}, ctx);
      expect(buildApiFetch).not.toHaveBeenCalled();
    });
  });

  describe('toolDefinition record', () => {
    it('exposes feature, action, destructive, hardBlocks, preferredModel', () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'pauseAd',
        description: 'd',
        inputSchema: z.object({
          adId: z.string(),
          confirmationToken: z.string().optional(),
        }),
        destructive: true,
        destructiveAction: 'pause_campaign',
        preferredModel: 'opus',
        hardBlocks: ['noLiveCampaignChangeDuringLearningPhase'],
        summarizeForConfirmation: async () => ({ resourceId: 'x' }),
        execute: async () => ({}),
      });

      expect(tool.feature).toBe('meta-ads');
      expect(tool.action).toBe('pauseAd');
      expect(tool.destructive).toBe(true);
      expect(tool.hardBlocks).toEqual([
        'noLiveCampaignChangeDuringLearningPhase',
      ]);
      expect(tool.preferredModel).toBe('opus');
      expect(tool.destructiveAction).toBe('pause_campaign');
    });

    it('defaults preferredModel to sonnet', () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'listCampaigns',
        description: 'd',
        inputSchema: z.object({}),
        destructive: false,
        execute: async () => ({}),
      });
      expect(tool.preferredModel).toBe('sonnet');
    });
  });

  it('returns hard-block result without making the bug invisible if runner throws', async () => {
    const tool = defineTool({
      feature: 'meta-ads',
      action: 'launchAd',
      description: 'd',
      inputSchema: z.object({
        adId: z.string(),
        confirmationToken: z.string().optional(),
      }),
      destructive: true,
      destructiveAction: 'launch_ad',
      hardBlocks: ['someValidator'],
      summarizeForConfirmation: async () => ({ resourceId: 'ad-1' }),
      execute: async () => ({}),
    });
    const runHardBlocks: HardBlockRunner = async () => {
      throw new Error('runner blew up');
    };
    const ctx = buildCtx({ runHardBlocks });

    const result = await tool.execute({ adId: 'ad-1' }, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('HARD_BLOCK_RUNNER_FAILED');
    }
  });
  describe('reportIssue (manual soft-failure capture)', () => {
    const mockedWarn = logWarning as jest.Mock;
    const mockedError = logError as jest.Mock;

    it('injects a tool-bound reportIssue that logs a warning by default', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'softFail',
        description: 'swallows errors',
        inputSchema: z.object({}),
        destructive: false,
        // A swallow-style tool: catches, reports, returns friendly data.
        execute: async (_input, ctx) => {
          ctx.reportIssue('Lookup failed', {
            error: new Error('boom'),
            extra: { adId: 'ad-9' },
          });
          return { data: { ok: false } as never };
        },
      });

      const result = await tool.execute({}, buildCtx());

      // The friendly result is preserved — reportIssue must not break it.
      expect(result.ok).toBe(true);
      expect(mockedWarn).toHaveBeenCalledTimes(1);
      const [operation, summary, context] = mockedWarn.mock.calls[0];
      // Operation carries the tool name; context carries bound identifiers.
      expect(operation).toBe('claire.tool.meta_ads_softFail');
      expect(summary).toBe('Lookup failed');
      expect(context.feature).toBe('claire');
      expect(context.user).toEqual({ id: 'user-1' });
      expect(context.extra).toMatchObject({
        tool: 'meta_ads_softFail',
        organizationId: 'org-1',
        conversationId: 'conv-1',
        adId: 'ad-9',
        cause: 'boom',
      });
      expect(mockedError).not.toHaveBeenCalled();
    });

    it('routes level:error through logError', async () => {
      const tool = defineTool({
        feature: 'meta-ads',
        action: 'hardSoftFail',
        description: 'swallows a hard error',
        inputSchema: z.object({}),
        destructive: false,
        execute: async (_input, ctx) => {
          ctx.reportIssue('Critical lookup failed', {
            error: new Error('kaboom'),
            level: 'error',
          });
          return { data: {} as never };
        },
      });

      await tool.execute({}, buildCtx());

      expect(mockedError).toHaveBeenCalledTimes(1);
      const [operation, error] = mockedError.mock.calls[0];
      expect(operation).toBe('claire.tool.meta_ads_hardSoftFail');
      expect((error as Error).message).toBe('kaboom');
    });
  });

  describe('circuit breaker (identical-failure)', () => {
    const failingTool = defineTool<{ x: string }, unknown>({
      feature: 'meta-ads',
      action: 'flaky',
      description: 'always throws',
      inputSchema: z.object({ x: z.string() }),
      destructive: false,
      execute: async () => {
        throw new Error('boom');
      },
    });

    it('passes the first identical failure through untouched', async () => {
      const failureTracker = createToolFailureTracker();
      const result = await failingTool.execute(
        { x: 'a' },
        buildCtx({ failureTracker })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
        expect(result.presentation).toBeUndefined();
      }
    });

    it('trips to stop_and_ask on the second identical failure in the turn', async () => {
      const failureTracker = createToolFailureTracker();
      const ctx = buildCtx({ failureTracker });

      const first = await failingTool.execute({ x: 'a' }, ctx);
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.presentation).toBeUndefined();

      const second = await failingTool.execute({ x: 'a' }, ctx);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.presentation?.type).toBe('stop_and_ask');
        expect(second.error).toMatch(/stop and ask/i);
      }
    });

    it('does NOT trip when there is no failure tracker on the context', async () => {
      const result = await failingTool.execute({ x: 'a' }, buildCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.presentation).toBeUndefined();
    });

    it('never trips a successful tool', async () => {
      const okTool = defineTool<{ x: string }, { ok: boolean }>({
        feature: 'meta-ads',
        action: 'reliable',
        description: 'always ok',
        inputSchema: z.object({ x: z.string() }),
        destructive: false,
        execute: async () => ({ data: { ok: true } }),
      });
      const failureTracker = createToolFailureTracker();
      const ctx = buildCtx({ failureTracker });
      const first = await okTool.execute({ x: 'a' }, ctx);
      const second = await okTool.execute({ x: 'a' }, ctx);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });

    it('counts different failure signatures independently', async () => {
      const failureTracker = createToolFailureTracker();
      const ctx = buildCtx({ failureTracker });

      // A validation failure (bad input) is a different signature than the
      // execute throw, so one of each must NOT trip the breaker.
      const validationFail = await failingTool.execute({}, ctx);
      const throwFail = await failingTool.execute({ x: 'a' }, ctx);
      expect(validationFail.ok).toBe(false);
      expect(throwFail.ok).toBe(false);
      if (!validationFail.ok)
        expect(validationFail.presentation).toBeUndefined();
      if (!throwFail.ok) expect(throwFail.presentation).toBeUndefined();
    });
  });
});

// Sanity-check the unused HardBlockResult type does not get tree-shaken into the test run
const _typecheckHardBlockResult: HardBlockResult = { pass: true };
void _typecheckHardBlockResult;
