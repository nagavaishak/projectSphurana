import { randomUUID } from 'node:crypto';
import { createAnthropicClient } from '@borradh-workspace/ai';
import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { storageEnv } from '@borradh-workspace/env/storage';
import {
  type ResolvedSkillRegistry,
  SKILL_REGISTRY_VERSION,
  classifyIntent,
  createConversation,
  formatKnowledgeContext,
  generateConversationTitle,
  getAssistantContext,
  getAssistantUsage,
  getConversation,
  getPlanAssistantLimits,
  incrementAssistantUsage,
  queryKnowledge,
  saveMessages,
  setInitialSkillState,
  skillRegistry,
  summariseConversation,
  updateConversation,
} from '@borradh-workspace/features/assistant';
import { getSubscription } from '@borradh-workspace/features/billing';
import {
  buildBusinessProfileContext,
  buildDisagreementNote,
} from '@borradh-workspace/features/claire';
import { getContentItemState } from '@borradh-workspace/features/content-items';
import { getMetaIntegration } from '@borradh-workspace/features/integrations';
import { logError } from '@borradh-workspace/observability';
import type { UIMessage } from 'ai';
import {
  buildActiveContextSystemText,
  buildContentItemContextSystemText,
  parseActiveContext,
} from '../lib/active-context.js';
import { buildAllowedImageHosts } from '../lib/build-allowed-image-hosts.js';
import { buildClaireTurnInputs } from '../lib/build-claire-turn-inputs.js';
import { convertToAnthropicMessages } from '../lib/convert-to-anthropic-messages.js';
import { buildDraftClipsSystemText } from '../lib/draft-clips-system-text.js';
import {
  type PersistedToolPart,
  runToolLoop,
} from '../lib/manual-tool-loop.js';
import type { UIStreamPlan } from '../lib/respond-ui-stream.js';
import { sanitizeToolPairing } from '../lib/sanitize-tool-pairing.js';
import { resolveCallerRole } from '../tool-factory/index.js';
import { adAccountCurrencyForPages } from '../tools/_shared/ad-currency.js';
import {
  type PromptOverrides,
  formatExtraDirectives,
  toOrchestratorOverrides,
} from './prompt-overrides.js';

/** Body validation knobs preserved from the v2 controller. */
const MAX_MESSAGES_PER_REQUEST = 100;
const MAX_TOTAL_CONTENT_BYTES = 512 * 1024;

/** Allow long multi-step tool conversations (3 minutes — preserved verbatim
 *  from the v2 controller). */
export const STREAM_TIMEOUT_MS = 180_000;

/** Request body accepted by `POST assistant/chat`. */
export interface AssistantChatBody {
  messages: UIMessage[];
  conversationId?: string;
  /**
   * W-C18 active context — when the user navigates to `/assistant`
   * from a feature page (e.g. lead detail dialog), the URL carries
   * `entityType` + `entityId`. The frontend forwards them on the
   * **first** send only; a one-line system hint is injected into the
   * per-turn system prompt. Subsequent turns inherit naturally via
   * conversation history.
   */
  entityType?: string;
  entityId?: string;
  /**
   * Local prompt-tuning hook (uncommitted dev tool). Lets the operator
   * override prompt pieces + tool descriptions and append free-text
   * directives from the chat UI so Claire's recommendation/tone/tool
   * behaviour can be tweaked live without a redeploy. See `prompt-config`
   * and `prompt-preview`.
   */
  overrides?: PromptOverrides;
}

/** The subset of the NestJS logger this use case needs. */
export interface ChatTurnLogger {
  log: (message: unknown, ...optional: unknown[]) => void;
  warn: (message: unknown, ...optional: unknown[]) => void;
  error: (message: unknown, ...optional: unknown[]) => void;
}

export interface PlanAssistantChatTurnParams {
  body: AssistantChatBody;
  organizationId: string;
  userId: string;
  /** Request cookie, forwarded into loopback tool calls. */
  cookie: string;
  /** Bearer authorization, forwarded into loopback tool calls. */
  authorization?: string;
  /**
   * Branch the chat request was scoped to (`X-Location-Id`, already validated
   * against the active org by `LocationGuard`). Forwarded onto every loopback
   * tool call so Claire's catalogue, prices and calendar match the branch the
   * user is looking at.
   */
  locationId?: string;
  logger: ChatTurnLogger;
}

/** Extract concatenated text content from a UIMessage's parts array. */
function extractTextFromMessage(message: UIMessage): string {
  return (
    message.parts
      ?.filter(
        (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> =>
          p.type === 'text'
      )
      .map((p) => p.text)
      .join(' ') ?? ''
  );
}

/**
 * Decide everything about one Claire chat turn and hand back a transport-free
 * plan: either a rejection (status + JSON body) or a stream whose `run` emits
 * already-decided UI stream events.
 *
 * This is a verbatim lift of the controller's `chat` body minus the four calls
 * that touched the `Response` object (header write, event write, terminator,
 * socket timeout). Ordering of every DB call, log line, `$ai_generation`
 * attribution and emitted event is unchanged.
 */
export async function planAssistantChatTurn(
  params: PlanAssistantChatTurnParams
): Promise<UIStreamPlan> {
  const {
    body,
    organizationId,
    userId,
    cookie,
    authorization,
    locationId,
    logger,
  } = params;

  // 1. Validate Anthropic credentials. Optional in env validation; this is the
  //    runtime presence check (mirrors the v2 OPENAI_API_KEY pattern).
  if (!apiEnv.ANTHROPIC_API_KEY) {
    return {
      kind: 'reject',
      status: 500,
      body: { error: 'Anthropic API key not configured' },
    };
  }

  // Require an active organization (mirrors AssistantController). Without it
  // every downstream org-scoped query/insert fails — surfacing to the client
  // as a generic "Failed to create conversation" instead of a clear 400.
  if (!organizationId) {
    return {
      kind: 'reject',
      status: 400,
      body: {
        error: 'No active organization selected',
        code: 'NO_ACTIVE_ORG',
      },
    };
  }

  // 2. Validate messages.
  const { messages } = body;
  if (!messages?.length) {
    return {
      kind: 'reject',
      status: 400,
      body: { error: 'Messages required' },
    };
  }

  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    return {
      kind: 'reject',
      status: 400,
      body: {
        error: `Too many messages (max ${MAX_MESSAGES_PER_REQUEST})`,
        code: 'MESSAGE_LIMIT',
      },
    };
  }

  let totalContentBytes = 0;
  for (const msg of messages) {
    totalContentBytes += Buffer.byteLength(extractTextFromMessage(msg), 'utf8');
    if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
      return {
        kind: 'reject',
        status: 413,
        body: {
          error: 'Message content too large',
          code: 'PAYLOAD_TOO_LARGE',
        },
      };
    }
  }

  // 3. Plan / quota check.
  const subResult = await getSubscription(db, { organizationId });
  const planId = subResult.success ? subResult.data.planId : 'free';
  const limits = getPlanAssistantLimits(planId);

  if (!limits.hasAssistantAccess) {
    return {
      kind: 'reject',
      status: 403,
      body: {
        error: 'Assistant not available on your plan',
        code: 'NO_ACCESS',
      },
    };
  }

  const usageResult = await getAssistantUsage(db, { organizationId });
  if (!usageResult.success) {
    return {
      kind: 'reject',
      status: 500,
      body: { error: 'Failed to check usage' },
    };
  }

  const { daily, monthly } = usageResult.data;
  if (daily >= limits.maxMessagesPerDay) {
    return {
      kind: 'reject',
      status: 429,
      body: {
        error: 'Daily message limit reached',
        code: 'DAILY_LIMIT',
        limit: limits.maxMessagesPerDay,
        used: daily,
      },
    };
  }
  if (monthly >= limits.maxMessagesPerMonth) {
    return {
      kind: 'reject',
      status: 429,
      body: {
        error: 'Monthly message limit reached',
        code: 'MONTHLY_LIMIT',
        limit: limits.maxMessagesPerMonth,
        used: monthly,
      },
    };
  }

  // 4. Resolve conversation. 409 on escalated (one-way handoff).
  //    Also surfaces the persisted skill state (loadedSkillIds +
  //    skillRegistryVersion) for existing conversations — the orchestrator
  //    builder consumes them in step 7 below. Pre-W-C03-D-prep rows had
  //    these columns NULL; the migration backfilled to `[]` and `1`, and
  //    the schema NOT NULL guarantees we never see null here.
  let conversationId = body.conversationId;
  let persistedLoadedSkillIds: string[] = [];
  let persistedRegistryVersion: number = SKILL_REGISTRY_VERSION;
  let isFirstTurn = false;

  if (conversationId) {
    const convResult = await getConversation(db, {
      id: conversationId,
      organizationId,
      userId,
    });
    if (!convResult.success) {
      return {
        kind: 'reject',
        status: 404,
        body: { error: 'Conversation not found' },
      };
    }
    if (convResult.data.status === 'escalated') {
      return {
        kind: 'reject',
        status: 409,
        body: {
          error: 'Conversation has been escalated',
          code: 'CONVERSATION_ESCALATED',
        },
      };
    }
    persistedLoadedSkillIds = convResult.data.loadedSkillIds;
    persistedRegistryVersion = convResult.data.skillRegistryVersion;

    // The frontend PRE-CREATES the conversation (so conversationId is present
    // from the very first chat message) but nothing's been classified yet.
    // Without this, the first-turn intent classifier below never runs, the
    // conversation starts on the default skill only, and the model has to
    // `meta_loadSkill` the right skill mid-turn — which surfaces as clumsy,
    // out-of-order tool calls (e.g. guessing an offer price, then loading the
    // campaign skill AFTER the user confirms). Treat the first message of an
    // uninitialised conversation (no assistant turn yet, no skills loaded) as
    // the first turn so the right skill is active from message #1.
    const hasPriorAssistantTurn = messages.some((m) => m.role === 'assistant');
    if (!hasPriorAssistantTurn && persistedLoadedSkillIds.length === 0) {
      isFirstTurn = true;
    }
  }

  if (!conversationId) {
    const convResult = await createConversation(db, {
      organizationId,
      userId,
    });
    if (!convResult.success) {
      return {
        kind: 'reject',
        status: 500,
        body: { error: 'Failed to create conversation' },
      };
    }
    conversationId = convResult.data.id;
    isFirstTurn = true;

    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (firstUserMessage) {
      const textContent = extractTextFromMessage(firstUserMessage);
      if (textContent) {
        const title =
          textContent.length > 100
            ? `${textContent.slice(0, 97)}...`
            : textContent;
        await updateConversation(db, {
          id: conversationId,
          organizationId,
          userId,
          title,
        });
      }
    }
  }

  // Skill registry pin drift — non-fatal, just visibility. Conversations
  // run against the pinned version (Q31b), so a notice here helps when
  // debugging "why isn't this conversation seeing the new skill prompt?".
  if (!isFirstTurn && persistedRegistryVersion !== SKILL_REGISTRY_VERSION) {
    logger.log(
      `Conversation ${conversationId} pinned to skill registry v${persistedRegistryVersion}; current v${SKILL_REGISTRY_VERSION}`
    );
  }

  // 5. Org context + 6. knowledge retrieval (preserved verbatim).
  const ctxResult = await getAssistantContext(db, { organizationId });
  if (!ctxResult.success) {
    return {
      kind: 'reject',
      status: 404,
      body: { error: 'Organization not found' },
    };
  }

  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'user');
  const lastUserText = lastUserMessage
    ? extractTextFromMessage(lastUserMessage)
    : '';

  let knowledgeContext = '';
  if (lastUserText) {
    try {
      // Pass `userId` so user-personal entries (`remember`-tool memories,
      // conversation summaries) surface alongside the org-wide rows.
      // Org-wide rows still come back when called with a userId — the
      // post-W-C13-schema query is `org-wide ∪ this user's personal`.
      const results = await queryKnowledge(db, {
        query: lastUserText,
        organizationId,
        userId,
        topK: 10,
      });
      knowledgeContext = formatKnowledgeContext(results);
    } catch {
      logger.error('Knowledge query failed');
    }
  }

  // 6.5 First-turn intent classification (W-C03-D-finish).
  //     The classifier picks an initial skill set on conversation creation
  //     so the orchestrator's Block 3 can carry the relevant skill's
  //     prompt fragment from message #1. Mid-conversation pivots use the
  //     `meta_loadSkill` tool instead. The classifier is fail-soft: any
  //     error → `['default']`, conversation continues unaffected.
  if (isFirstTurn && lastUserText) {
    const classification = await classifyIntent({
      userMessage: lastUserText,
      organizationId,
    });
    // `classifyIntent` is itself wrapped in `trackedResult` and never
    // surfaces a failure path through `success: false` — its fallback
    // path returns `ok({ skillIds: ['default'], confidence: 0 })`. The
    // success check is defensive in case the contract changes.
    const classified = classification.success
      ? classification.data.skillIds
      : ['default'];
    // `'default'` is implicit and never persisted (see brief gotchas) —
    // strip it so a row never carries the redundant entry. The default
    // skill's tools are re-added at build time.
    const toPersist = classified.filter((id) => id !== 'default');

    // Single skill registry for every conversation. The version is persisted
    // as a record stamp on the conversation row.
    const selectedRegistry = skillRegistry;

    const setResult = await setInitialSkillState(db, {
      conversationId,
      organizationId,
      loadedSkillIds: toPersist,
      skillRegistryVersion: selectedRegistry.version,
    });
    if (setResult.success) {
      persistedLoadedSkillIds = setResult.data.loadedSkillIds;
      persistedRegistryVersion = setResult.data.skillRegistryVersion;
    } else {
      // Don't fail the turn — log and continue with the schema defaults
      // (empty array + version 1). The conversation runs as
      // "default skill only" and the model can still call
      // `meta_loadSkill` later.
      logger.error('Failed to persist initial skill state', setResult.error);
    }
  }

  // 6.6 Active context (W-C18 cross-app entry points).
  //     Frontend forwards `entityType` + `entityId` from the URL on the
  //     first send only; we inject a one-line system hint for this turn.
  //     Subsequent turns inherit via conversation history (per the brief
  //     — no persistence, no per-turn re-injection). Malformed input is
  //     silently dropped (a stale URL or future-version entity type
  //     shouldn't break the chat).
  const activeContext = parseActiveContext({
    entityType: body.entityType,
    entityId: body.entityId,
  });
  let activeContextText = activeContext
    ? buildActiveContextSystemText(
        activeContext.entityType,
        activeContext.entityId
      )
    : undefined;

  // A queued post gets the richer line — the ids Claire would already be
  // holding if she had made it herself. Best-effort: the plain line is still
  // correct, just less useful, so a read failure must not cost the turn.
  if (activeContext?.entityType === 'content_item') {
    const state = await getContentItemState(db, {
      itemId: activeContext.entityId,
      organizationId,
    }).catch(() => null);
    if (state?.success) {
      activeContextText = buildContentItemContextSystemText({
        itemId: state.data.itemId,
        kind: state.data.kind,
        assetId: state.data.assetId,
        caption: state.data.caption,
        reviewStatus: state.data.reviewStatus,
        textFields: state.data.textFields,
        templateKey: state.data.templateKey,
      });
    }
  }

  // Viewing a queued post loads the review skill, without waiting for the
  // classifier to infer it from the words.
  //
  // The classifier reads the MESSAGE, and on this surface the message is
  // routinely "change slide 2" or "word it differently" — sentences that say
  // nothing about content queues. The context does. Left to the classifier,
  // Claire answered "I need the item ID" while the id was sitting in her system
  // prompt, because nothing she could reach took one.
  if (
    activeContext?.entityType === 'content_item' &&
    !persistedLoadedSkillIds.includes('review-content')
  ) {
    persistedLoadedSkillIds = [...persistedLoadedSkillIds, 'review-content'];
  }

  // 6.7 Polling-on-send draft-clips block (W-C10-clip-tray Step 7).
  //     If the org has an active video draft with at least one tray row,
  //     fold a one-line summary into the system prompt so async ingest
  //     state (clip flips from `processing` → `ready`) surfaces by the
  //     next operator send. Best-effort — DB hiccups must never break
  //     the chat response.
  let draftClipsText: string | null = null;
  try {
    draftClipsText = await buildDraftClipsSystemText({ organizationId });
  } catch (err) {
    logger.warn(`Draft-clips system text failed: ${String(err)}`);
  }

  // 6.8 Claire-engine enrichment (Window 6).
  //     - Business profile: ranked services + 3-axis classification, so
  //       Claire knows which service to push when the user mentions ads.
  //     - Classifier disagreement: one-time system note when the
  //       classifier disagrees with the operator's override (Decision #6).
  //     Both are best-effort; we never break the chat over an enrichment
  //     miss.
  let claireProfileText: string | null = null;
  let claireDisagreementText: string | null = null;
  try {
    const profile = await buildBusinessProfileContext(db, organizationId);
    if (profile.success) claireProfileText = profile.data;
  } catch (err) {
    logger.warn(`Claire business-profile context failed: ${String(err)}`);
  }
  try {
    const disagreement = await buildDisagreementNote(db, organizationId);
    if (disagreement.success) claireDisagreementText = disagreement.data;
  } catch (err) {
    logger.warn(`Claire disagreement note failed: ${String(err)}`);
  }

  // Ad-account currency (ENG-626). Threaded into the system context so Claire
  // reasons about budgets/prices in the connected ad account's currency even
  // when she answers WITHOUT calling a currency-bearing tool. The pending
  // budget/price and campaign tools also derive from this same source, so the
  // conversational text and the tool cards can't disagree. EUR fallback when no
  // account is connected — Claire is told to surface that assumption.
  let claireCurrencyText: string | null = null;
  try {
    const integ = await getMetaIntegration(db, { organizationId });
    if (integ.success && integ.data) {
      const integration = integ.data;
      // The SAME selection + guard the budget/price tools use (active pages
      // only, then defaultPageId), so the prompt and the tool cards can never
      // resolve different pages or different currencies. A supported (valid,
      // 2-decimal) ISO code yields the definite line; null/unknown/zero-decimal
      // degrades to the EUR-assumption line.
      const { currency, supported } = adAccountCurrencyForPages(
        integration.pages,
        integration.defaultPageId
      );
      claireCurrencyText = supported
        ? `**Ad-account currency: ${currency.code} (${currency.symbol}).** Express every ad budget and price in ${currency.code} using the "${currency.symbol}" symbol — this is the currency the connected Meta ad account bills in. Never default to euros unless the currency actually is EUR.`
        : `**Ad-account currency: unknown** — the connected Meta ad account hasn't reported a usable currency (or none is connected yet). Assume EUR (€) for any budgets/prices, but tell the operator you're assuming EUR and they should (re)connect their Meta ad account to confirm the real currency.`;
    }
  } catch (err) {
    logger.warn(`Claire currency context failed: ${String(err)}`);
  }

  // Single skill registry — Block 2/3 prompt assembly and the per-turn tool
  // list both source from it.
  const registry: ResolvedSkillRegistry = skillRegistry;

  // 7 + 8. Shared turn-input assembly (WS-5).
  //    The orchestrator system prompt (Block layout: [persona, skill-index,
  //    loaded-skills?, business context] with per-turn dynamic segments
  //    appended to the uncached Block 4), the tool catalogue + skill-driven
  //    tool map, and the factory/legacy tool execution context are all
  //    assembled by `buildClaireTurnInputs` so the web controller and the
  //    WhatsApp worker (WS-10) share one builder. The pinned `registry` is
  //    threaded in so the v30/v31 skill content + tools flow end to end.
  //    `channel` is threaded (default 'web') for WS-9/WS-10.
  // Live prompt-tuning overrides (dev tool). All fail-soft: a malformed
  // bundle just falls back to registered defaults.
  const promptOverrides = body.overrides;
  const orchestratorOverrides = toOrchestratorOverrides(promptOverrides);
  const extraDirectivesText = formatExtraDirectives(
    promptOverrides?.extraDirectives
  );

  // Same `member` row RoleGuard reads. Resolved once per turn so a tool's
  // declared policy is enforceable without relying on the loopback hop.
  const callerRole = await resolveCallerRole({ userId, organizationId });
  const turnInputs = buildClaireTurnInputs({
    orgContext: ctxResult.data,
    organizationId,
    userId,
    callerRole,
    conversationId,
    channel: 'web',
    loadedSkillIds: persistedLoadedSkillIds,
    knowledgeContext,
    activeContextText,
    draftClipsText,
    claireProfileText,
    claireDisagreementText,
    currencyContextText: claireCurrencyText,
    extraDirectivesText,
    orchestratorOverrides,
    toolDescriptionOverrides: promptOverrides?.toolDescriptions,
    // Thread the conversation's pinned registry so the shared builder
    // sources its skill content + tool list from v30/v31 accordingly.
    registry,
    cookie,
    authorization,
    locationId,
    logger: {
      error: (...args) => logger.error(...(args as [string, ...string[]])),
    },
  });
  const { system, toolMap, toolCtx, buildToolMap, buildSystemBlocks } =
    turnInputs;

  // 9. Stream: emit the turn, then persist. `conversationId` is narrowed to a
  //    string by the resolution above; capture it so the closure sees it.
  const resolvedConversationId = conversationId;

  return {
    kind: 'stream',
    headers: { 'X-Conversation-Id': resolvedConversationId },
    run: async ({ emit, close }) => {
      const messageId = randomUUID();
      emit({ type: 'start', messageId });

      let finalText = '';
      let persistedToolParts: PersistedToolPart[] = [];
      try {
        const client = createAnthropicClient(
          apiEnv.ANTHROPIC_API_KEY as string
        );
        // Image attachments must originate from the assistant-uploads bucket
        // (or the configured CDN). The converter drops parts whose URL host
        // is outside this list to prevent Anthropic from fetching
        // attacker-controlled URLs on our behalf.
        const allowedImageHosts = buildAllowedImageHosts({
          bucket: storageEnv.S3_ASSISTANT_UPLOADS_BUCKET,
          region: storageEnv.S3_REGION,
          endpoint: storageEnv.S3_ENDPOINT,
          cdnUrl: storageEnv.CDN_URL,
        });
        const initialMessages = sanitizeToolPairing(
          convertToAnthropicMessages(messages, { allowedImageHosts }),
          {
            warn: (msg, ...meta) =>
              logger.warn(msg as string, ...(meta as string[])),
          }
        );

        // Model + maxTokens come from the shared builder (Sonnet 4.6 default;
        // Opus 4.7 routing per skill ships in W-C03-D).
        const result = await runToolLoop({
          client,
          model: turnInputs.model,
          system,
          initialMessages,
          toolMap,
          toolCtx,
          maxTokens: turnInputs.maxTokens,
          // PostHog LLM observability — attribute each streamed round to the
          // acting user + org, and group all turns of this conversation into a
          // single PostHog trace.
          observability: {
            distinctId: userId,
            organizationId,
            traceId: resolvedConversationId,
            spanName: 'assistant.chat',
          },
          emit,
          logger: {
            error: (message, ...optional) =>
              logger.error(message as string, ...(optional as string[])),
            log: (message, ...optional) =>
              logger.log(message as string, ...(optional as string[])),
          },
          // Mid-turn skill rebuild — when `meta_loadSkill` lands, swap the
          // tool list + system blocks so the freshly-loaded skill's tools
          // are immediately reachable in the next round of the same turn.
          // The W-C18 active context survives the rebuild — the builder's
          // `buildSystemBlocks` re-applies the same per-turn appended segments
          // (knowledge, active context, draft clips, Claire enrichment,
          // operator directives), so the model still benefits from the entity
          // hint after the skill swap.
          onSkillsChanged: (newLoadedSkillIds) => ({
            toolMap: buildToolMap(newLoadedSkillIds),
            system: buildSystemBlocks(newLoadedSkillIds),
          }),
        });

        finalText = result.finalText;
        persistedToolParts = result.toolParts;
        emit({
          type: 'finish',
          finishReason: result.streamError
            ? 'error'
            : result.stopReason === 'tool_use'
              ? 'tool-calls'
              : result.stopReason === 'end_turn' ||
                  result.stopReason === 'stop_sequence'
                ? 'stop'
                : result.stopReason === 'max_tokens'
                  ? 'length'
                  : 'stop',
        });
      } catch (streamError) {
        logger.error('Anthropic chat stream failed', streamError);
        // The whole turn failed (model call / tool loop). The user only sees a
        // generic "something went wrong" — surface it to Sentry with context so
        // it isn't invisible. (the Nest logger is Pino-only; logError → Sentry.)
        logError('assistant.chatStream', streamError, {
          feature: 'assistant',
          user: { id: userId },
          extra: { organizationId, conversationId: resolvedConversationId },
        });
        emit({
          type: 'error',
          errorText: 'Something went wrong. Please try again in a moment.',
        });
        emit({ type: 'finish', finishReason: 'error' });
      }

      close();

      // 10. Persistence — saveMessages, increment usage, optional title.
      try {
        await saveMessages(db, {
          conversationId: resolvedConversationId,
          organizationId,
          userId,
          userMessageContent: lastUserText,
          assistantText: finalText,
          // Persist tool parts so the frontend can rehydrate preview cards,
          // loading tiles, and result cards on refresh / back-navigate.
          // Empty array OK — saveMessages treats it as "no tool data".
          toolCalls:
            persistedToolParts.length > 0 ? persistedToolParts : undefined,
        });

        incrementAssistantUsage(db, { organizationId }).catch((err) =>
          logger.error('Failed to increment usage', err)
        );

        const isFirstExchange =
          messages.filter((m) => m.role === 'user').length === 1;
        if (isFirstExchange && lastUserText && finalText) {
          generateConversationTitle(db, {
            conversationId: resolvedConversationId,
            organizationId,
            userId,
            userMessage: lastUserText,
            assistantResponse: finalText,
          }).catch(() => {});
        }

        // C-13 conversation-summary populator: fire-and-forget hook that
        // writes a `(orgId, userId)`-scoped `conversation_summary` knowledge
        // entry per turn. The service rate-limits to once per hour per
        // conversation, skips short threads, and runs the d2b validator
        // (noFabricatedResultClaims + noPomBrandNamesInAdCopy) before any
        // write. Best-effort — summary failures must never break the chat
        // response, so we swallow everything here. Sentry breadcrumbs are
        // emitted by trackedResult inside the service.
        summariseConversation(db, {
          conversationId: resolvedConversationId,
          organizationId,
          userId,
        }).catch((err) =>
          logger.error('Failed to summarise conversation', err)
        );
      } catch (persistError) {
        logger.error('Error saving messages:', persistError);
        logError('assistant.persistMessages', persistError, {
          feature: 'assistant',
          user: { id: userId },
          extra: { organizationId, conversationId: resolvedConversationId },
        });
      }
    },
  };
}
