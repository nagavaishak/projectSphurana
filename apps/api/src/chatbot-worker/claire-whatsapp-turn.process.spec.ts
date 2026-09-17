/**
 * WS-10 integration gate — the Claire-on-WhatsApp worker process function.
 *
 * Drives `processClaireWhatsappTurn` end-to-end with:
 *   - a MOCKED `runClaireTurn` engine that scripts a turn by driving the real
 *     `CollectingSink` (so the real `assembleHeadlessTurnResult` + the real,
 *     pure `renderWhatsappTurn` planner run and we assert the real send shape);
 *   - a MOCKED WhatsAppCloudService (injected via `deps.whatsappService`) that
 *     captures the outbound sends — no real WABA;
 *   - mocked features-package services (conversation find/create, pending-
 *     confirmation gate, saveMessages) and a mocked Anthropic client.
 *
 * Two scenarios:
 *   (a) a normal owner turn that shows an ad `preview_card` → captured sends
 *       carry the creative media + a text summary + the "reply launch" CTA, and
 *       the pending-confirmation gate is ARMED (`setPendingConfirmation`).
 *   (b) a "launch" follow-up while a confirmation is pending → the worker passes
 *       the WS-8 `confirmedActions` allow-list into the tool context, the turn
 *       publishes, and the gate is CLEARED (`clearPendingConfirmation`).
 *
 * The process fn imports `@borradh-workspace/features/assistant`, the api turn-
 * input builder, and `@borradh-workspace/database`, all of which transitively
 * pull cuid2 (ESM) jest can't transform — so they're mocked. The renderer
 * (`render-whatsapp-turn.ts`) and the sink/assemble helpers run for real (their
 * only heavy imports are inside the async `resolvePreviewMedia`, which we
 * override via `deps.resolvePreviewMediaFn`).
 */

// --- ESM-heavy / DB barrels (cuid2) ----------------------------------------
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {
    ANTHROPIC_API_KEY: 'test-key',
    INTERNAL_SERVICE_TOKEN: 'test-internal-token',
    CLAIRE_WHATSAPP_PHONE_NUMBER_ID: 'claire-pnid',
    CLAIRE_WHATSAPP_ACCESS_TOKEN: 'claire-token',
    PORT: 3001,
    CDN_URL: 'https://cdn.test',
    APP_URL: 'https://app.test',
  },
}));
jest.mock('@borradh-workspace/ai', () => ({
  createAnthropicClient: jest.fn(() => ({})),
}));
jest.mock('@borradh-workspace/observability', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
  logError: jest.fn(),
}));
jest.mock('@borradh-workspace/integrations/whatsapp', () => ({
  WhatsAppCloudService: class {},
}));

// --- features/assistant services -------------------------------------------
const findOrCreateWhatsappConversation = jest.fn();
const getAssistantContext = jest.fn();
const getConversationMessages = jest.fn();
const saveMessages = jest.fn();
const setPendingConfirmation = jest.fn();
const clearPendingConfirmation = jest.fn();
const getAssistantUsage = jest.fn();
jest.mock('@borradh-workspace/features/assistant', () => ({
  findOrCreateWhatsappConversation: (...a: unknown[]) =>
    findOrCreateWhatsappConversation(...a),
  getAssistantContext: (...a: unknown[]) => getAssistantContext(...a),
  getConversationMessages: (...a: unknown[]) => getConversationMessages(...a),
  saveMessages: (...a: unknown[]) => saveMessages(...a),
  setPendingConfirmation: (...a: unknown[]) => setPendingConfirmation(...a),
  clearPendingConfirmation: (...a: unknown[]) => clearPendingConfirmation(...a),
  getAssistantUsage: (...a: unknown[]) => getAssistantUsage(...a),
  getPlanAssistantLimits: () => ({
    maxMessagesPerDay: 100,
    maxMessagesPerMonth: 3000,
  }),
}));

const getSubscription = jest.fn();
jest.mock('@borradh-workspace/features/billing', () => ({
  getSubscription: (...a: unknown[]) => getSubscription(...a),
}));

// --- api turn-input builder + tool factory (pull the features barrel) ------
const buildClaireTurnInputs = jest.fn();
jest.mock('../assistant/lib/build-claire-turn-inputs.js', () => ({
  buildClaireTurnInputs: (...a: unknown[]) => buildClaireTurnInputs(...a),
}));
const buildAssistantToolsContext = jest.fn();
jest.mock('../assistant/tool-factory/index.js', () => ({
  buildAssistantToolsContext: (...a: unknown[]) =>
    buildAssistantToolsContext(...a),
  // The worker resolves the caller's org role so a tool's declared `policy`
  // can be enforced (fail-closed on undefined). Stubbed to 'owner' here: this
  // spec is about the WS-10 turn flow, not authorization — that is pinned in
  // `tool-factory/tool-policy.spec.ts`.
  resolveCallerRole: jest.fn(async () => 'owner'),
}));

// --- the engine: scripted so the real CollectingSink runs ------------------
import type { CollectingSink } from '../assistant/lib/collecting-sink.js';
import type { RunClaireTurnParams } from '../assistant/lib/run-claire-turn.js';

/** A scripted engine run: drive the passed-in sink, return the run result. */
let scriptRun: (sink: CollectingSink) => {
  finalText: string;
  rounds: number;
  stopReason: 'end_turn';
  toolParts: unknown[];
};
const runClaireTurn = jest.fn(async (params: RunClaireTurnParams) => {
  return scriptRun(params.sink as CollectingSink);
});
jest.mock('../assistant/lib/run-claire-turn.js', () => ({
  runClaireTurn: (...a: unknown[]) => runClaireTurn(...a),
}));

import {
  type ClaireWhatsappTurnDeps,
  processClaireWhatsappTurn,
} from './claire-whatsapp-turn.process.js';

// --- helpers ---------------------------------------------------------------

function okConv(over: Record<string, unknown> = {}) {
  return {
    success: true as const,
    data: {
      id: 'conv-1',
      loadedSkillIds: ['create-campaign'],
      pendingConfirmation: null,
      isNew: false,
      ...over,
    },
  };
}

function makeInputs() {
  return {
    model: 'claude-x',
    maxTokens: 4096,
    system: [{ type: 'text', text: 'sys' }],
    toolMap: {},
    toolCtx: {},
    buildToolMap: jest.fn(() => ({})),
    buildSystemBlocks: jest.fn(() => [{ type: 'text', text: 'sys' }]),
  };
}

/** Capturing WhatsApp service satisfying the `Pick<…>` deps shape. */
function captureService() {
  const sends: unknown[] = [];
  return {
    sends,
    service: {
      sendTextMessage: jest.fn(async (_to: string, body: string) => {
        sends.push({ kind: 'text', body });
        return { messageId: 'm', success: true };
      }),
      sendMediaMessage: jest.fn(
        async (
          _to: string,
          opts: { type: 'image' | 'video'; link: string; caption?: string }
        ) => {
          sends.push({ kind: 'media', mediaType: opts.type, link: opts.link });
          return { messageId: 'm', success: true };
        }
      ),
    } satisfies ClaireWhatsappTurnDeps['whatsappService'],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getAssistantContext.mockResolvedValue({
    success: true,
    data: { id: 'org-1', name: 'Glow Clinic' },
  });
  getConversationMessages.mockResolvedValue({ success: true, data: [] });
  saveMessages.mockResolvedValue({ success: true, data: {} });
  setPendingConfirmation.mockResolvedValue({ success: true, data: {} });
  clearPendingConfirmation.mockResolvedValue({ success: true, data: {} });
  getSubscription.mockResolvedValue({ success: true, data: { planId: 'pro' } });
  getAssistantUsage.mockResolvedValue({
    success: true,
    data: { daily: 0, monthly: 0 },
  });
  buildClaireTurnInputs.mockReturnValue(makeInputs());
  buildAssistantToolsContext.mockReturnValue({});
});

const PAYLOAD = {
  userId: 'user-1',
  organizationId: 'org-1',
  fromPhoneE164: '353871234567',
  userMessage: 'create a campaign for my facials',
  inboundMessageId: 'wamid-1',
};

describe('processClaireWhatsappTurn (WS-10)', () => {
  it('(a) normal owner turn with an ad preview → media + summary + CTA sends, gate ARMED', async () => {
    findOrCreateWhatsappConversation.mockResolvedValue(okConv());

    // Script the turn: one text block, then an ad preview_card tool event.
    scriptRun = (sink) => {
      sink.onTextStart({ id: 't1' });
      sink.onTextDelta({ id: 't1', delta: "Here's your campaign preview." });
      sink.onTextEnd({ id: 't1' });

      sink.onToolInputAvailable({
        toolCallId: 'call-1',
        toolName: 'claire_showAdPreview',
        input: { draftId: 'draft-9' },
      });
      sink.onToolOutputAvailable({
        toolCallId: 'call-1',
        output: {
          missing: [],
          presentation: {
            type: 'preview_card',
            kind: 'ad',
            draftId: 'draft-9',
            state: {
              headline: 'Glow facial - 20% off',
              primaryText: 'Treat yourself this month.',
              callToAction: 'Book Now',
            },
          },
        },
      });
      return {
        finalText: "Here's your campaign preview.",
        rounds: 2,
        stopReason: 'end_turn',
        toolParts: [{ toolName: 'claire_showAdPreview' }],
      };
    };

    const { service, sends } = captureService();
    const deps: ClaireWhatsappTurnDeps = {
      whatsappService: service,
      // Pretend the creative resolved to an image link (skips S3).
      resolvePreviewMediaFn: async () => [
        {
          toolCallId: 'call-1',
          media: { mediaType: 'image', link: 'https://cdn.test/creative.jpg' },
        },
      ],
    };

    const result = await processClaireWhatsappTurn(PAYLOAD, deps);

    // Engine + tool context built on the whatsapp channel, NO confirmedActions
    // (nothing pending on this first turn).
    expect(buildClaireTurnInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        hasPendingConfirmation: false,
      })
    );
    expect(buildAssistantToolsContext).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp' })
    );
    expect(buildAssistantToolsContext.mock.calls[0][0]).not.toHaveProperty(
      'confirmedActions'
    );

    // Captured sends: text bubble, then media, then summary, then the CTA.
    const kinds = sends.map((s) => (s as { kind: string }).kind);
    expect(kinds).toEqual(['text', 'media', 'text', 'text']);

    const media = sends[1] as { kind: string; mediaType: string; link: string };
    expect(media).toEqual({
      kind: 'media',
      mediaType: 'image',
      link: 'https://cdn.test/creative.jpg',
    });

    const summary = sends[2] as { body: string };
    expect(summary.body).toContain('Glow facial - 20% off');
    const cta = sends[3] as { body: string };
    expect(cta.body.toLowerCase()).toContain('launch');

    // Gate ARMED for the next inbound message; nothing cleared.
    expect(setPendingConfirmation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        conversationId: 'conv-1',
        organizationId: 'org-1',
        kind: 'ad',
        draftId: 'draft-9',
      })
    );
    expect(clearPendingConfirmation).not.toHaveBeenCalled();

    expect(result.conversationId).toBe('conv-1');
    expect(result.finalText).toBe("Here's your campaign preview.");
  });

  it('(b) "launch" follow-up with a pending ad confirmation → publish path fires, gate CLEARED', async () => {
    // Conversation already carries a pending ad confirmation.
    findOrCreateWhatsappConversation.mockResolvedValue(
      okConv({ pendingConfirmation: { kind: 'ad', draftId: 'draft-9' } })
    );

    const publishToolInput = jest.fn();
    // Script: the model publishes (no preview this turn), confirms in text.
    scriptRun = (sink) => {
      sink.onToolInputAvailable({
        toolCallId: 'call-pub',
        toolName: 'claire_publishAd',
        input: { draftId: 'draft-9' },
      });
      publishToolInput(); // marker that the publish tool ran
      sink.onToolOutputAvailable({
        toolCallId: 'call-pub',
        output: { published: true, campaignId: 'camp-1' },
      });
      sink.onTextStart({ id: 't1' });
      sink.onTextDelta({
        id: 't1',
        delta: 'Your campaign is live! 🎉',
      });
      sink.onTextEnd({ id: 't1' });
      return {
        finalText: 'Your campaign is live! 🎉',
        rounds: 2,
        stopReason: 'end_turn',
        toolParts: [{ toolName: 'claire_publishAd' }],
      };
    };

    const { service, sends } = captureService();
    const deps: ClaireWhatsappTurnDeps = {
      whatsappService: service,
      resolvePreviewMediaFn: async () => [],
    };

    const result = await processClaireWhatsappTurn(
      { ...PAYLOAD, userMessage: 'launch', inboundMessageId: 'wamid-2' },
      deps
    );

    // Prompt told it's pending; tool context carries the WS-8 allow-list so the
    // factory executes the publish without a confirmation token.
    expect(buildClaireTurnInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        hasPendingConfirmation: true,
      })
    );
    expect(buildAssistantToolsContext).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        confirmedActions: ['launch_ad'],
      })
    );

    // Publish ran; gate CLEARED, not re-armed (no new preview this turn).
    expect(publishToolInput).toHaveBeenCalled();
    expect(clearPendingConfirmation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        conversationId: 'conv-1',
        organizationId: 'org-1',
      })
    );
    expect(setPendingConfirmation).not.toHaveBeenCalled();

    // The owner gets the confirmation text bubble.
    expect(sends).toEqual([
      { kind: 'text', body: 'Your campaign is live! 🎉' },
    ]);
    expect(result.finalText).toBe('Your campaign is live! 🎉');
  });

  it('loads prior DB turns into initialMessages so the turn has conversation context', async () => {
    findOrCreateWhatsappConversation.mockResolvedValue(okConv());

    // The worker has no client to resend the thread, so it loads history from
    // the DB. Stored rows (chronological) → rebuilt into the run's history.
    getConversationMessages.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'm1',
          role: 'user',
          content: 'I want to start a campaign',
          toolCalls: null,
          toolResults: null,
          attachments: null,
          createdAt: new Date(1),
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Great — what does the service cost?',
          toolCalls: null,
          toolResults: null,
          attachments: null,
          createdAt: new Date(2),
        },
      ],
    });

    scriptRun = (sink) => {
      sink.onTextStart({ id: 't1' });
      sink.onTextDelta({ id: 't1', delta: 'Perfect, €100 it is.' });
      sink.onTextEnd({ id: 't1' });
      return {
        finalText: 'Perfect, €100 it is.',
        rounds: 1,
        stopReason: 'end_turn' as const,
        toolParts: [],
      };
    };

    const { service } = captureService();
    await processClaireWhatsappTurn(
      { ...PAYLOAD, userMessage: '€100', inboundMessageId: 'wamid-3' },
      { whatsappService: service, resolvePreviewMediaFn: async () => [] }
    );

    // History was loaded for this conversation.
    expect(getConversationMessages).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        conversationId: 'conv-1',
        organizationId: 'org-1',
      })
    );

    // The engine received the prior turns BEFORE the new inbound message.
    const runParams = runClaireTurn.mock.calls[0][0] as {
      initialMessages: { role: string; content: unknown }[];
    };
    const texts = runParams.initialMessages.map((m) =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    );
    expect(texts.join(' | ')).toContain('I want to start a campaign');
    expect(texts.join(' | ')).toContain('what does the service cost');
    // New inbound message is the final user turn.
    const last = runParams.initialMessages.at(-1);
    expect(last).toEqual({ role: 'user', content: '€100' });
  });
});
