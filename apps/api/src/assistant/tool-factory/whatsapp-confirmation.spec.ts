/**
 * WS-8 — channel-aware confirmation gate.
 *
 * Proves that on the `'whatsapp'` channel a destructive tool whose
 * `destructiveAction` is listed in `ctx.confirmedActions` executes WITHOUT a
 * confirmation token (the inbound text affirmation, resolved upstream in the
 * worker, IS the confirmation — Q4a). Web behavior is unchanged: without the
 * whatsapp channel + a matching confirmed action, the destructive tool still
 * issues a `confirmation_required` token on the first (token-less) call.
 */

// The factory's confirmation.ts imports the real token services + db barrel at
// module load; stub both so the spec is self-contained.
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
}));
jest.mock('./telemetry.js', () => ({
  trackToolCalled: jest.fn(),
  trackToolConfirmed: jest.fn(),
  trackToolFailed: jest.fn(),
}));

import { z } from 'zod';
import { defineTool } from './define-tool.js';
import { createToolCallCounter } from './tool-call-limit.js';
import type { AssistantToolsContext } from './types.js';

const executeImpl = jest.fn(async () => ({ data: { adId: 'ad-live-1' } }));

const publishTool = defineTool<
  { draftId: string; confirmationToken?: string },
  { adId: string }
>({
  feature: 'claire',
  action: 'publishAd',
  description: 'Publish the draft ad.',
  inputSchema: z.object({
    draftId: z.string().min(1),
    confirmationToken: z.string().optional(),
  }),
  destructive: true,
  destructiveAction: 'launch_ad',
  summarizeForConfirmation: async (input) => ({
    resourceId: input.draftId,
    title: 'Publish draft ad',
    payload: { draftId: input.draftId },
  }),
  execute: executeImpl,
});

function buildCtx(
  overrides: Partial<AssistantToolsContext> = {}
): AssistantToolsContext {
  const apiFetch = jest.fn() as never;
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch),
    callCounter: createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation: jest.fn(async () => ({
      id: 'token-abc',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    })) as never,
    verifyConfirmation: jest.fn(async () => ({
      valid: true,
      payload: null,
    })) as never,
    ...overrides,
  };
}

describe('WS-8 channel-aware confirmation gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('whatsapp + matching confirmed action → publish executes without a token', async () => {
    const ctx = buildCtx({
      channel: 'whatsapp',
      confirmedActions: ['launch_ad'],
    });

    const result = await publishTool.execute({ draftId: 'draft-1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ adId: 'ad-live-1' });
    expect(executeImpl).toHaveBeenCalledTimes(1);
    // No token was issued — the affirmation satisfied the gate directly.
    expect(ctx.createConfirmation).not.toHaveBeenCalled();
  });

  it('whatsapp + confirmed action still runs hard blocks; a failing block blocks publish', async () => {
    // Re-define a tool with a hard block to assert defense-in-depth survives
    // the bypass.
    const guardedExecute = jest.fn(async () => ({ data: { adId: 'x' } }));
    const guardedTool = defineTool<{ draftId: string }, { adId: string }>({
      feature: 'claire',
      action: 'publishAdGuarded',
      description: 'Publish guarded.',
      inputSchema: z.object({ draftId: z.string().min(1) }),
      destructive: true,
      destructiveAction: 'launch_ad',
      hardBlocks: ['some_block'],
      summarizeForConfirmation: async (input) => ({
        resourceId: input.draftId,
      }),
      execute: guardedExecute,
    });

    const ctx = buildCtx({
      channel: 'whatsapp',
      confirmedActions: ['launch_ad'],
      runHardBlocks: jest.fn(async () => ({
        pass: false,
        code: 'BLOCKED',
        message: 'nope',
      })) as never,
    });

    const result = await guardedTool.execute({ draftId: 'draft-1' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BLOCKED');
    expect(guardedExecute).not.toHaveBeenCalled();
  });

  it('whatsapp but action NOT confirmed → still requires confirmation (issues token)', async () => {
    const ctx = buildCtx({ channel: 'whatsapp', confirmedActions: [] });

    const result = await publishTool.execute({ draftId: 'draft-1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.presentation?.type).toBe('confirmation_required');
    expect(ctx.createConfirmation).toHaveBeenCalledTimes(1);
    expect(executeImpl).not.toHaveBeenCalled();
  });

  it('whatsapp + mismatched confirmed action → still requires confirmation', async () => {
    const ctx = buildCtx({
      channel: 'whatsapp',
      confirmedActions: ['create_offer'], // not launch_ad
    });

    const result = await publishTool.execute({ draftId: 'draft-1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.presentation?.type).toBe('confirmation_required');
    expect(executeImpl).not.toHaveBeenCalled();
  });

  it('web channel (no token) → unchanged: requires confirmation even if confirmedActions set', async () => {
    // confirmedActions is only honored on whatsapp; on web it must be ignored.
    const ctx = buildCtx({ confirmedActions: ['launch_ad'] });

    const result = await publishTool.execute({ draftId: 'draft-1' }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.presentation?.type).toBe('confirmation_required');
    expect(ctx.createConfirmation).toHaveBeenCalledTimes(1);
    expect(executeImpl).not.toHaveBeenCalled();
  });

  it('web channel with a valid token → executes (existing path still works)', async () => {
    const ctx = buildCtx();
    const result = await publishTool.execute(
      { draftId: 'draft-1', confirmationToken: 'token-abc' },
      ctx
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ adId: 'ad-live-1' });
    expect(ctx.verifyConfirmation).toHaveBeenCalledTimes(1);
    expect(executeImpl).toHaveBeenCalledTimes(1);
  });
});
