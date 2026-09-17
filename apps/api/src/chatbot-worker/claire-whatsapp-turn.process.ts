import { createAnthropicClient } from '@borradh-workspace/ai';
import type { Anthropic } from '@borradh-workspace/ai';
import type { ClaireConfirmationAction } from '@borradh-workspace/database';
import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type ClaireWhatsappTurnJobPayload,
  clearPendingConfirmation,
  findOrCreateWhatsappConversation,
  getAssistantContext,
  getAssistantUsage,
  getConversationMessages,
  getPlanAssistantLimits,
  saveMessages,
  setPendingConfirmation,
} from '@borradh-workspace/features/assistant';
import { getSubscription } from '@borradh-workspace/features/billing';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { createLogger, logError } from '@borradh-workspace/observability';
import { buildClaireTurnInputs } from '../assistant/lib/build-claire-turn-inputs.js';
import {
  CollectingSink,
  assembleHeadlessTurnResult,
} from '../assistant/lib/collecting-sink.js';
import { convertStoredToAnthropicMessages } from '../assistant/lib/convert-stored-to-anthropic-messages.js';
import {
  type ResolvedPreviewMedia,
  type WhatsappSend,
  deliverWhatsappSends,
  renderWhatsappTurn,
  resolvePreviewMedia,
} from '../assistant/lib/render-whatsapp-turn.js';
import { runClaireTurn } from '../assistant/lib/run-claire-turn.js';
import {
  buildAssistantToolsContext,
  resolveCallerRole,
} from '../assistant/tool-factory/index.js';

const logger = createLogger('ClaireWhatsappTurn');

/**
 * Deterministic affirmation detector. On the WhatsApp channel, a pending
 * destructive-action gate (an ad/offer preview awaiting confirmation) is
 * satisfied by a plain text affirmation (plan Q4a — the dedicated number +
 * verified pairing are the security boundary, not a budget echo). We keep this
 * OUT of the tool (per WS-8) — the worker decides; the tool just honours the
 * per-turn `confirmedActions` allow-list.
 */
const AFFIRMATION_RE = /^\s*(launch|yes|publish|confirm|go ahead)\b/i;

export function isAffirmation(text: string): boolean {
  return AFFIRMATION_RE.test(text);
}

/** A `preview_card` presentation carried on a collected tool event. */
function asPreviewCard(
  presentation: unknown
): { kind: 'ad' | 'offer'; draftId: string } | null {
  if (typeof presentation !== 'object' || presentation === null) return null;
  const p = presentation as Record<string, unknown>;
  if (p.type !== 'preview_card') return null;
  if (p.kind !== 'ad' && p.kind !== 'offer') return null;
  if (typeof p.draftId !== 'string' || p.draftId.length === 0) return null;
  return { kind: p.kind, draftId: p.draftId };
}

/**
 * Injectable dependencies. Production passes nothing (real Anthropic client +
 * real Claire WABA service). The testing endpoint injects a mocked Anthropic
 * client and a send-capturing service so the full pipeline runs WITHOUT the
 * real number.
 */
export interface ClaireWhatsappTurnDeps {
  /** Build the Anthropic client. Default: real client from the API key. */
  makeClient?: () => Anthropic;
  /** The WhatsApp send service (Claire WABA creds in prod; a capturing stub in
   *  tests). Default: a real `WhatsAppCloudService` on the Claire credentials. */
  whatsappService?: Pick<
    WhatsAppCloudService,
    'sendTextMessage' | 'sendMediaMessage' | 'sendInteractiveMessage'
  >;
  /** Override media resolution (tests skip S3). Default: the real resolver. */
  resolvePreviewMediaFn?: (
    result: Parameters<typeof resolvePreviewMedia>[0]
  ) => Promise<ResolvedPreviewMedia[]>;
}

export interface ClaireWhatsappTurnResult {
  conversationId: string;
  /** The ordered sends that were (or would be) delivered to the owner. */
  sends: WhatsappSend[];
  finalText: string;
}

/**
 * Build the real Claire WABA send service from the dedicated-number creds.
 * Constructed lazily so the flag-off / test paths never require the secrets.
 */
export function buildClaireWhatsappService(): Pick<
  WhatsAppCloudService,
  'sendTextMessage' | 'sendMediaMessage' | 'sendInteractiveMessage'
> {
  return new WhatsAppCloudService(
    apiEnv.CLAIRE_WHATSAPP_ACCESS_TOKEN,
    apiEnv.CLAIRE_WHATSAPP_PHONE_NUMBER_ID
  );
}

/**
 * Run one full Claire turn for a paired owner over WhatsApp and deliver the
 * rendered sends back to the dedicated Claire number.
 *
 * This is the WS-10 worker sequence (documented in `render-whatsapp-turn.ts`):
 *   a. find/create the whatsapp assistant conversation
 *   b. read pendingConfirmation → hasPendingConfirmation
 *   c. build turn inputs (channel='whatsapp'; affirmation→confirmedActions)
 *   d. run the engine with a CollectingSink
 *   e. persist the turn (saveMessages with toolParts)
 *   f. set/clear the pendingConfirmation gate from the rendered previews
 *   g. resolve preview media → render sends → deliver
 *
 * Returns the planned sends so the testing endpoint can assert on them with a
 * mocked send service.
 */
export async function processClaireWhatsappTurn(
  payload: ClaireWhatsappTurnJobPayload,
  deps: ClaireWhatsappTurnDeps = {}
): Promise<ClaireWhatsappTurnResult> {
  const apiKey = apiEnv.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Worker env parity (memory: a var a feature needs is needed by BOTH api +
    // worker). The operator sets ANTHROPIC_API_KEY on the worker; without it we
    // cannot run a turn.
    throw new Error('Anthropic API key not configured (worker)');
  }

  const { userId, organizationId, fromPhoneE164, userMessage } = payload;

  // Internal service-auth: the worker has no browser session, so loopback tool
  // calls authenticate via the internal acts-as path. Without the shared secret
  // those calls would 401 — abort the turn loudly rather than run unauthenticated.
  const internalToken = apiEnv.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new Error(
      'INTERNAL_SERVICE_TOKEN not configured (worker) — cannot authenticate Claire loopback API calls'
    );
  }
  const internalAuth = {
    token: internalToken,
    userId,
    organizationId,
  };

  // (a) find/create the persistent whatsapp conversation.
  const convResult = await findOrCreateWhatsappConversation(db, {
    organizationId,
    userId,
    whatsappPhoneE164: fromPhoneE164,
  });
  if (!convResult.success) {
    throw new Error(
      `Failed to resolve whatsapp conversation: ${convResult.error.message}`
    );
  }
  const {
    id: conversationId,
    loadedSkillIds,
    pendingConfirmation,
  } = convResult.data;

  // Usage cap — same check as the web controller (daily + monthly).
  const subResult = await getSubscription(db, { organizationId });
  const planId = subResult.success ? subResult.data.planId : 'free';
  const limits = getPlanAssistantLimits(planId);
  const usageResult = await getAssistantUsage(db, { organizationId });
  if (usageResult.success) {
    const { daily, monthly } = usageResult.data;
    if (
      daily >= limits.maxMessagesPerDay ||
      monthly >= limits.maxMessagesPerMonth
    ) {
      const capMsg =
        daily >= limits.maxMessagesPerDay
          ? "You've reached your daily message limit. I'll be back tomorrow!"
          : "You've reached your monthly message limit. Your quota resets next month.";
      const capSends: WhatsappSend[] = [
        { kind: 'text' as const, body: capMsg },
      ];
      const service = deps.whatsappService ?? buildClaireWhatsappService();
      await deliverWhatsappSends(service, fromPhoneE164, capSends);
      return { conversationId, sends: capSends, finalText: capMsg };
    }
  }

  // (b) compute the pending-confirmation boolean for the prompt.
  const hasPendingConfirmation = pendingConfirmation != null;

  // org context (in-process read).
  const ctxResult = await getAssistantContext(db, { organizationId });
  if (!ctxResult.success) {
    throw new Error(`Organization not found: ${organizationId}`);
  }

  // (c) decide whether this inbound text confirms the pending action (WS-8).
  let confirmedActions: ClaireConfirmationAction[] | undefined;
  if (hasPendingConfirmation && isAffirmation(userMessage)) {
    const pc = asPreviewCard({
      type: 'preview_card',
      kind: pendingConfirmation?.kind,
      draftId: pendingConfirmation?.draftId,
    });
    if (pc) {
      confirmedActions = [pc.kind === 'ad' ? 'launch_ad' : 'create_offer'];
    }
  }

  // Build turn inputs (WS-5). The builder constructs its own tool context, but
  // it does NOT thread channel/confirmedActions, so we rebuild the tool context
  // here with the WS-8 allow-list and override it on the run call.
  const callerRole = await resolveCallerRole({ userId, organizationId });

  // NO `locationId` on this path, deliberately.
  //
  // A WhatsApp turn has no branch signal to resolve one FROM: the org has a
  // single Claire number (plan §9 puts per-location numbers out of scope), and
  // the sender's phone says nothing about which branch they mean. Guessing —
  // e.g. defaulting to the org's primary location — would quote the primary
  // branch's overridden price to a customer of a different branch with a
  // confidence the data does not support. Leaving it unset keeps the CURRENT
  // behaviour exactly: base catalogue, base prices, org-wide reads.
  //
  // The real fix is to make Claire ASK which branch when the org has more than
  // one, and it needs a prompt change plus a held-out eval run; it is NOT
  // something to slip in silently here. See the report accompanying Phase 2.
  const inputs = buildClaireTurnInputs({
    orgContext: ctxResult.data,
    organizationId,
    userId,
    callerRole,
    conversationId,
    channel: 'whatsapp',
    hasPendingConfirmation,
    loadedSkillIds: (loadedSkillIds ?? []).filter((id) => id !== 'default'),
    internalAuth,
    logger: { error: (...args) => logger.error(String(args[0]), { args }) },
  });

  const toolCtx = buildAssistantToolsContext({
    organizationId,
    userId,
    callerRole,
    conversationId,
    internalAuth,
    port: apiEnv.PORT,
    cdnUrl: apiEnv.CDN_URL,
    appUrl: apiEnv.APP_URL,
    channel: 'whatsapp',
    ...(confirmedActions ? { confirmedActions } : {}),
  });

  const client = (deps.makeClient ?? (() => createAnthropicClient(apiKey)))();

  // Rebuild prior-turn history from the DB. Unlike the web chat (where the
  // client resends the whole thread each request), the worker has no client,
  // so we load the persisted turns and convert them through the SAME web
  // pipeline (stored rows → UIMessage[] → Anthropic) to preserve
  // tool_use/tool_result pairing. The window is bounded in the feature service
  // (most-recent-N) so this persistent, ever-growing thread can't blow up the
  // prompt. The current inbound message is saved AFTER the turn, so it is not
  // in this history — we append it as the final user turn.
  let history: Anthropic.MessageParam[] = [];
  const historyResult = await getConversationMessages(db, {
    conversationId,
    organizationId,
  });
  if (historyResult.success) {
    history = convertStoredToAnthropicMessages(historyResult.data, {
      logger: {
        warn: (message, ...meta) => logger.warn(message, { meta }),
      },
    });
  } else {
    // History is best-effort: a load failure degrades to a contextless turn
    // (today's behaviour) rather than dropping the message entirely.
    logger.warn('Failed to load WhatsApp conversation history', {
      conversationId,
      error: historyResult.error.message,
    });
  }

  const initialMessages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  // (d) run the engine with a CollectingSink.
  const sink = new CollectingSink();
  const runResult = await runClaireTurn({
    client,
    model: inputs.model,
    system: inputs.system,
    initialMessages,
    toolMap: inputs.toolMap,
    toolCtx,
    maxTokens: inputs.maxTokens,
    sink,
    logger: {
      error: (...args) => logger.error('[claireWhatsappTurn]', { args }),
      log: () => undefined,
    },
    onSkillsChanged: (ids) => ({
      toolMap: inputs.buildToolMap(ids),
      system: inputs.buildSystemBlocks(ids),
    }),
  });

  const result = assembleHeadlessTurnResult(sink.collected, runResult);

  // (e) persist the turn (best-effort — delivery shouldn't block on a save).
  try {
    await saveMessages(db, {
      conversationId,
      organizationId,
      userId,
      userMessageContent: userMessage,
      assistantText: result.finalText,
      toolCalls: result.toolParts.length > 0 ? result.toolParts : undefined,
    });
  } catch (error) {
    logError('assistant.claireWhatsappTurn.saveMessages', error, {
      feature: 'assistant',
      extra: { conversationId },
    });
  }

  // (f) set/clear the confirmation gate from the rendered previews.
  let previewShown: { kind: 'ad' | 'offer'; draftId: string } | null = null;
  for (const event of result.toolEvents) {
    if (event.errorText) continue;
    const preview = asPreviewCard(event.presentation);
    if (preview) previewShown = preview; // last preview wins
  }

  if (previewShown) {
    // A preview was shown this turn → arm the gate for the next message.
    await setPendingConfirmation(db, {
      conversationId,
      organizationId,
      kind: previewShown.kind,
      draftId: previewShown.draftId,
    });
  } else if (confirmedActions || hasPendingConfirmation) {
    // Clear the gate when: (a) we just published (confirmedActions), OR
    // (b) the owner sent a non-affirmation while the gate was armed — they
    // changed topic, so the stale draft must not be triggerable later.
    await clearPendingConfirmation(db, { conversationId, organizationId });
  }

  // (g) resolve media → plan sends → deliver.
  const resolveMedia = deps.resolvePreviewMediaFn ?? resolvePreviewMedia;
  const previewMedia = await resolveMedia(result);
  const sends = renderWhatsappTurn(result, { previewMedia });

  const service = deps.whatsappService ?? buildClaireWhatsappService();
  await deliverWhatsappSends(service, fromPhoneE164, sends);

  return { conversationId, sends, finalText: result.finalText };
}
