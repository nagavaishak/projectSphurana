// Mock the heavy transitive chain before importing tools/tool-factory. The
// chain reaches: `tool-factory/index.ts` → `confirmation.ts` → both
// `@borradh-workspace/database` (ships `@paralleldrive/cuid2`, ESM-only) AND
// `@borradh-workspace/features/assistant` (ships `@t3-oss/env-core`,
// ESM-only). swc-jest doesn't transform those node_modules packages, so the
// import phase blows up. Same precedent W-C02-D used in
// `hard-blocks.spec.ts`. We mock the surface area the factory + tools touch:
//   - `offerDiscountTypeValues` / `offerStateValues` — real lists, used by
//     `z.enum()` at module load.
//   - `db` — unused; the test injects `createConfirmation` /
//     `verifyConfirmation` directly via the tools context.
jest.mock('@borradh-workspace/database', () => ({
  offerDiscountTypeValues: ['percentage', 'fixed_price', 'buy_x_get_y'],
  offerStateValues: ['draft', 'active', 'paused', 'expired'],
  db: {},
}));

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
import { createOfferTool } from './create-offer.tool.js';
import { expireOfferTool } from './expire-offer.tool.js';
import { extendOfferTool } from './extend-offer.tool.js';
import { getOfferPerformanceTool } from './get-offer-performance.tool.js';

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    timezone: 'Europe/Dublin',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
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

describe('offers tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getOfferPerformanceTool — non-destructive read
  // -------------------------------------------------------------------------
  describe('getOfferPerformanceTool', () => {
    it('uses the factory feature/action prefix in the tool name', () => {
      expect(getOfferPerformanceTool.name).toBe('offers_getOfferPerformance');
      expect(getOfferPerformanceTool.feature).toBe('offers');
      expect(getOfferPerformanceTool.action).toBe('getOfferPerformance');
      expect(getOfferPerformanceTool.destructive).toBe(false);
    });

    it('returns the offer + flags missing performance metrics', async () => {
      const apiFetch = jest.fn(async () => ({
        offer: {
          id: 'off-1',
          organizationId: 'org-1',
          name: 'Spring sale',
          code: null,
          state: 'active',
          discountType: 'percentage',
          originalPriceCents: null,
          offerPriceCents: null,
          discountPercent: 20,
          buyQuantity: null,
          getQuantity: null,
          validFrom: '2026-04-01T00:00:00.000Z',
          validUntil: '2026-05-31T00:00:00.000Z',
        },
        serviceIds: ['svc-1', 'svc-2'],
        locationIds: ['loc-1'],
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await getOfferPerformanceTool.execute(
        { offerId: 'off-1' },
        ctx
      );

      expect(apiFetch).toHaveBeenCalledWith(
        'offers/off-1',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const out = result.data as {
          offerId: string;
          linkedServiceCount: number;
          linkedLocationCount: number;
          metricsAvailability: {
            viewsAvailable: false;
            conversionsAvailable: false;
            revenueAvailable: false;
            note: string;
          };
        };
        expect(out.offerId).toBe('off-1');
        expect(out.linkedServiceCount).toBe(2);
        expect(out.linkedLocationCount).toBe(1);
        expect(out.metricsAvailability.viewsAvailable).toBe(false);
        expect(out.metricsAvailability.note).toMatch(/not yet ingested/i);
      }
    });

    it('rejects empty offerId via Zod', async () => {
      const ctx = buildCtx();
      const result = await getOfferPerformanceTool.execute(
        { offerId: '' },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // createOfferTool — destructive, two-call flow
  // -------------------------------------------------------------------------
  describe('createOfferTool — non-destructive single-call', () => {
    it('is non-destructive, keeps its hard-block validators', () => {
      expect(createOfferTool.destructive).toBe(false);
      expect(createOfferTool.destructiveAction).toBeUndefined();
      expect(createOfferTool.hardBlocks).toEqual([
        'noDiscountBelowCost',
        'noFabricatedResultClaims',
      ]);
    });

    it('runs hard blocks then POSTs in one call (no confirmation token)', async () => {
      const created = {
        id: 'off-new',
        name: 'Spring facials',
        code: null,
        state: 'active',
        discountType: 'percentage',
        validFrom: null,
        validUntil: '2026-05-31T00:00:00.000Z',
        originalPriceCents: null,
        offerPriceCents: null,
        discountPercent: 20,
        buyQuantity: null,
        getQuantity: null,
      };
      const apiFetch = jest.fn(async () => created);
      const runHardBlocks = jest.fn(async () => ({ pass: true as const }));
      const createConfirmation = jest.fn();
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        runHardBlocks: runHardBlocks as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await createOfferTool.execute(
        {
          name: 'Spring facials',
          discountType: 'percentage',
          discountPercent: 20,
          validUntil: '2026-05-31T00:00:00.000Z',
        },
        ctx
      );

      // Safety validators still run, inline.
      expect(runHardBlocks).toHaveBeenCalledWith(
        ['noDiscountBelowCost', 'noFabricatedResultClaims'],
        expect.objectContaining({ name: 'Spring facials' }),
        expect.anything()
      );
      // No confirmation card / token — single call.
      expect(createConfirmation).not.toHaveBeenCalled();

      // POSTs directly, body is a plain object.
      expect(apiFetch).toHaveBeenCalledTimes(1);
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as unknown[];
      expect(calledPath).toBe('offers');
      const opts = calledOpts as {
        method?: string;
        body?: Record<string, unknown>;
      };
      expect(opts.method).toBe('POST');
      const body = opts.body ?? {};
      expect(typeof body).toBe('object');
      expect(body.name).toBe('Spring facials');
      expect(body.discountPercent).toBe(20);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(created);
    });

    it('resolves a relative validUntil expression server-side and POSTs the absolute date (Phase 3)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
      try {
        const created = { id: 'off-new' };
        const apiFetch = jest.fn(async () => created);
        const ctx = buildCtx({ apiFetch: apiFetch as never });

        await createOfferTool.execute(
          {
            name: 'Two-week intro',
            discountType: 'percentage',
            discountPercent: 20,
            validUntil: 'valid for 2 weeks',
          },
          ctx
        );

        const [, calledOpts] = apiFetch.mock.calls[0] as unknown[];
        const body =
          (calledOpts as { body?: Record<string, unknown> }).body ?? {};
        // 29 Jul + 14 days = 12 Aug; end-of-day Europe/Dublin (UTC+1) → 22:59Z.
        // The model passed words; the server resolved the absolute window.
        expect(String(body.validUntil)).toContain('2026-08-12');
      } finally {
        jest.useRealTimers();
      }
    });

    it('a failing hard block blocks the POST and surfaces the code + message', async () => {
      const runHardBlocks = jest.fn(async () => ({
        pass: false as const,
        code: 'noDiscountBelowCost',
        message: 'Discount too steep.',
      }));
      const apiFetch = jest.fn();
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        runHardBlocks: runHardBlocks as never,
      });

      const result = await createOfferTool.execute(
        {
          name: 'Free facials',
          discountType: 'percentage',
          discountPercent: 95,
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(apiFetch).not.toHaveBeenCalled();
      if (!result.ok) {
        expect(result.code).toBe('noDiscountBelowCost');
        if (result.presentation?.type === 'hard_block_violation') {
          expect(result.presentation.message).toMatch(/Discount too steep/);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // extendOfferTool — destructive
  // -------------------------------------------------------------------------
  describe('extendOfferTool', () => {
    it('is registered as destructive with extend_offer action', () => {
      expect(extendOfferTool.destructive).toBe(true);
      expect(extendOfferTool.destructiveAction).toBe('extend_offer');
      expect(extendOfferTool.hardBlocks).toEqual(['noDiscountBelowCost']);
    });

    it('first call: best-effort fetches the current offer and issues a token bound to offerId', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'offers/off-7') {
          return {
            offer: {
              id: 'off-7',
              name: 'Spring sale',
              state: 'active',
              validFrom: null,
              validUntil: '2026-04-30T00:00:00.000Z',
              discountType: 'percentage',
              originalPriceCents: null,
              offerPriceCents: null,
              discountPercent: 20,
              buyQuantity: null,
              getQuantity: null,
            },
            serviceIds: [],
            locationIds: [],
          };
        }
        throw new Error(`Unexpected path ${path}`);
      });
      const createConfirmation = jest.fn(async () => ({
        id: 'token-extend',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await extendOfferTool.execute(
        { offerId: 'off-7', newValidUntil: '2026-05-31T00:00:00.000Z' },
        ctx
      );

      expect(createConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'extend_offer',
          resourceId: 'off-7',
          payload: {
            previousValidUntil: '2026-04-30T00:00:00.000Z',
            newValidUntil: '2026-05-31T00:00:00.000Z',
          },
        })
      );
      // Only the GET happened — no PUT yet.
      const putCalls = apiFetch.mock.calls.filter((args) => {
        const opts = (args as unknown[])[1] as { method?: string } | undefined;
        return opts?.method === 'PUT';
      });
      expect(putCalls).toHaveLength(0);
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.action).toBe('extend_offer');
        expect(result.presentation.resourceId).toBe('off-7');
      }
    });

    it('issues confirmation even when current-offer lookup fails', async () => {
      // The summarize callback swallows fetch errors so the user still sees
      // intent-of-action; second-call verification binds against offerId.
      const apiFetch = jest.fn(async () => {
        throw new Error('boom');
      });
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
      });

      const result = await extendOfferTool.execute(
        { offerId: 'off-missing', newValidUntil: '2026-05-31T00:00:00.000Z' },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.resourceId).toBe('off-missing');
      }
    });

    it('second call: PUTs offers/:id with new validUntil', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'off-7',
        name: 'Spring sale',
        state: 'active',
        validFrom: null,
        validUntil: '2026-05-31T00:00:00.000Z',
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
      });

      await extendOfferTool.execute(
        {
          offerId: 'off-7',
          newValidUntil: '2026-05-31T00:00:00.000Z',
          confirmationToken: 'token-extend',
        },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as unknown[];
      expect(calledPath).toBe('offers/off-7');
      const opts = calledOpts as {
        method?: string;
        body?: Record<string, unknown>;
      };
      expect(opts.method).toBe('PUT');
      const body = opts.body ?? {};
      expect(body.validUntil).toBe('2026-05-31T00:00:00.000Z');
    });

    it('rejects an unresolvable date expression with a today-quoting message (Phase 3)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
      try {
        const ctx = buildCtx();
        const result = await extendOfferTool.execute(
          {
            offerId: 'off-7',
            newValidUntil: 'whenever-ish',
            confirmationToken: 'token-extend',
          },
          ctx
        );
        // Resolution now happens in execute; an unresolvable phrase surfaces as
        // a tool error whose message quotes today so the model self-corrects.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('TOOL_EXECUTION_ERROR');
          expect(result.error).toContain('2026-07-29');
        }
      } finally {
        jest.useRealTimers();
      }
    });

    it('resolves a relative newValidUntil to an absolute date on PUT (Phase 3)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
      try {
        const apiFetch = jest.fn(async () => ({ id: 'off-7' }));
        const ctx = buildCtx({ apiFetch: apiFetch as never });

        await extendOfferTool.execute(
          {
            offerId: 'off-7',
            newValidUntil: 'in 10 days',
            confirmationToken: 'token-extend',
          },
          ctx
        );

        const [, calledOpts] = apiFetch.mock.calls[0] as unknown[];
        const body =
          (calledOpts as { body?: Record<string, unknown> }).body ?? {};
        // 29 Jul + 10 days = 8 Aug (end of day).
        expect(String(body.validUntil)).toContain('2026-08-08');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // expireOfferTool — destructive, no hard blocks
  // -------------------------------------------------------------------------
  describe('expireOfferTool', () => {
    it('is registered as destructive with expire_offer action and no hard blocks', () => {
      expect(expireOfferTool.destructive).toBe(true);
      expect(expireOfferTool.destructiveAction).toBe('expire_offer');
      expect(expireOfferTool.hardBlocks).toEqual([]);
    });

    it('first call: issues a token bound to offerId, optional reason in payload', async () => {
      const apiFetch = jest.fn(async () => ({
        offer: {
          id: 'off-2',
          name: 'Q1 promo',
          state: 'active',
          validUntil: '2026-04-30T00:00:00.000Z',
        },
        serviceIds: [],
        locationIds: [],
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-expire',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await expireOfferTool.execute(
        { offerId: 'off-2', reason: 'Replaced by new offer' },
        ctx
      );

      expect(createConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'expire_offer',
          resourceId: 'off-2',
          payload: { reason: 'Replaced by new offer' },
        })
      );
      expect(result.ok).toBe(true);
    });

    it('second call: PUTs offers/:id with state=expired', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'off-2',
        name: 'Q1 promo',
        state: 'expired',
        validFrom: null,
        validUntil: '2026-04-30T00:00:00.000Z',
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
      });

      await expireOfferTool.execute(
        { offerId: 'off-2', confirmationToken: 'token-expire' },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as unknown[];
      expect(calledPath).toBe('offers/off-2');
      const opts = calledOpts as {
        method?: string;
        body?: Record<string, unknown>;
      };
      expect(opts.method).toBe('PUT');
      const body = opts.body ?? {};
      expect(body.state).toBe('expired');
    });

    it('omits payload when no reason is supplied', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'token-x',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const apiFetch = jest.fn(async () => ({
        offer: { id: 'off-2', name: 'X', state: 'active', validUntil: null },
        serviceIds: [],
        locationIds: [],
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      await expireOfferTool.execute({ offerId: 'off-2' }, ctx);

      const lastCall = createConfirmation.mock.calls[0]?.[0] as
        | { payload?: unknown }
        | undefined;
      expect(lastCall?.payload).toBeUndefined();
    });
  });
});
