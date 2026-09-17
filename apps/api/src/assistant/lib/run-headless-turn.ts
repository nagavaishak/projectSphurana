import { randomUUID } from 'node:crypto';
import { createAnthropicClient } from '@borradh-workspace/ai';
import type { Anthropic } from '@borradh-workspace/ai';
import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type AssistantContext,
  buildOrchestratorPrompt,
  buildToolListForSkills,
  getAssistantContext,
  getConversationMessages,
  saveMessages,
} from '@borradh-workspace/features/assistant';
import { getOrganizationWorkspace } from '@borradh-workspace/features/microsites';
import { createTurnBudget } from '@borradh-workspace/features/microsites';
import { logError } from '@borradh-workspace/observability';
import { buildMicrositeToolDefinitions } from '../../microsites/agent/microsite-tool-definitions.js';
import {
  type ToolDefinition,
  buildAssistantToolsContext,
  createApiFetch,
  resolveCallerRole,
} from '../tool-factory/index.js';
import {
  type AssistantToolsContext as LegacyAssistantToolsContext,
  createContentTools,
  legacyToolsToFactoryShape,
} from '../tools/index.js';
import { metaTools } from '../tools/meta/index.js';
import { buildToolRegistry } from '../tools/registry.js';
import {
  CollectingSink,
  assembleHeadlessTurnResult,
} from './collecting-sink.js';
import { convertStoredToAnthropicMessages } from './convert-stored-to-anthropic-messages.js';
import { type StreamErrorSignal, runClaireTurn } from './run-claire-turn.js';

/**
 * Headless (non-streaming) Claire turn runner — testing-only.
 *
 * This deliberately mirrors the orchestration `assistant-chat.controller.ts`
 * performs (tool catalogue → `buildToolMap` → `buildOrchestratorPrompt` →
 * `runToolLoop`) but with two key differences so it can drive a deterministic
 * test:
 *
 *   1. **Forced skills** — the caller passes `forceSkillIds` directly instead
 *      of letting `classifyIntent` (Haiku) pick the skill set on the first
 *      turn. This bypasses the LLM router so a test can target one skill's
 *      tools deterministically. The public `/assistant/chat` controller does
 *      NOT expose this; the override exists only on this testing entry point,
 *      keeping the production attack surface unchanged.
 *
 *   2. **No SSE** — instead of `SseSink`, this drives the shared
 *      `runClaireTurn` engine with a `CollectingSink`, which accumulates the
 *      turn's text + tool events in-memory rather than streaming UI events.
 *      The function returns the final assistant text plus the tool-call trace
 *      synchronously so a test can assert which tools fired.
 *
 * The model is still invoked for real — tool-argument generation within the
 * forced skill is non-deterministic. Tests should assert on the SHAPE of the
 * side effect (a tool fired, a row was created for this org) rather than on
 * exact model wording.
 *
 * @see assistant-chat.controller.ts — the production streaming counterpart
 * @see ./run-claire-turn.ts — the shared transport-agnostic per-turn engine
 * @see ./collecting-sink.ts — the headless accumulating sink
 */

export interface RunHeadlessTurnInput {
  organizationId: string;
  userId: string;
  conversationId: string;
  messageText: string;
  /**
   * Skill IDs to load for this turn, bypassing `classifyIntent`. `'default'`
   * is always unioned in (controller convention). Meta tools (`meta_remember`,
   * `meta_loadSkill`, `meta_dispatchTour`) are always loaded regardless.
   */
  forceSkillIds?: string[];
  /**
   * Session cookie value (`__Secure-better-auth.session_token=<token>`) used
   * by tools that call back into the API via `apiFetch` (e.g. `createService`,
   * `createLead`). Tools that write directly via `db` (e.g. `meta_remember`)
   * don't need it. Pass an empty string when no apiFetch'd tool is exercised.
   */
  cookie?: string;
  /**
   * Register the microsite agent's tools for this turn (contract §2's
   * registration rule: every tool is registered in BOTH the streaming
   * controller and here, or evals silently diverge from production).
   *
   * The microsite is resolved from the ORG, never from an argument — one
   * microsite per org, and a tool must not be able to name another tenant's
   * site. When the org has no microsite yet the tools are simply absent.
   */
  includeMicrositeTools?: boolean;
}

export interface HeadlessTurnToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export interface RunHeadlessTurnResult {
  conversationId: string;
  assistantText: string;
  toolCalls: HeadlessTurnToolCall[];
  streamError?: StreamErrorSignal;
}

/** Build the orchestrator system blocks for the given loaded skill set. */
function buildSystemBlocks(
  orgContext: AssistantContext,
  loadedSkillIds: string[]
): Anthropic.TextBlockParam[] {
  const { systemBlocks } = buildOrchestratorPrompt(orgContext, loadedSkillIds);
  return systemBlocks;
}

/**
 * Run a single Claire turn headlessly and return the assistant text + the
 * tool-call trace. Throws on hard failures (missing API key, unknown org);
 * the caller (testing service) wraps this in a `{ success, ... }` envelope.
 */
export async function runHeadlessTurn(
  input: RunHeadlessTurnInput
): Promise<RunHeadlessTurnResult> {
  if (!apiEnv.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key not configured');
  }

  const ctxResult = await getAssistantContext(db, {
    organizationId: input.organizationId,
  });
  if (!ctxResult.success) {
    throw new Error(`Organization not found: ${input.organizationId}`);
  }

  const cookie = input.cookie ?? '';
  const port = apiEnv.PORT;

  const callerRole = await resolveCallerRole({
    userId: input.userId,
    organizationId: input.organizationId,
  });

  const toolCtx = buildAssistantToolsContext({
    organizationId: input.organizationId,
    timezone: ctxResult.data.timezone,
    userId: input.userId,
    callerRole,
    conversationId: input.conversationId,
    cookie,
    port,
    cdnUrl: apiEnv.CDN_URL,
    appUrl: apiEnv.APP_URL,
  });

  // Legacy content tools still close over the v2-shaped context (sync
  // confirmation helpers). Mirror the controller wiring verbatim.
  const legacyApiFetch = createApiFetch({ cookie, port });
  const legacyCtx: LegacyAssistantToolsContext = {
    organizationId: input.organizationId,
    userId: input.userId,
    apiFetch: legacyApiFetch,
    cdnUrl: apiEnv.CDN_URL,
    appUrl: apiEnv.APP_URL,
  };
  const contentShimmed = legacyToolsToFactoryShape(
    createContentTools(legacyCtx)
  );

  // Catalogue every tool, keyed by canonical name + bare-action alias —
  // identical to the controller (assistant-chat.controller.ts step 8).
  const toolCatalogue = new Map<string, ToolDefinition>();
  const registerTool = (tool: ToolDefinition) => {
    if (toolCatalogue.has(tool.name)) return;
    toolCatalogue.set(tool.name, tool);
    if (!toolCatalogue.has(tool.action)) {
      toolCatalogue.set(tool.action, tool);
    }
  };
  for (const tool of buildToolRegistry(contentShimmed)) {
    registerTool(tool);
  }

  // The microsite agent's toolset. Built from the SAME
  // `buildMicrositeToolDefinitions` the streaming controller uses — there is
  // one list, so the two entry points cannot drift.
  const micrositeTools: ToolDefinition[] = [];
  if (input.includeMicrositeTools) {
    const workspace = await getOrganizationWorkspace(db, input.organizationId);
    if (workspace.success) {
      const definitions = buildMicrositeToolDefinitions({
        db,
        session: {
          micrositeId: workspace.data.micrositeId,
          organizationId: input.organizationId,
          userId: input.userId,
        },
        budget: createTurnBudget(),
        // A headless turn has no sidebar to click a confirmation in, so
        // destructive tools return their confirmation requirement and stop —
        // which is exactly what an eval should observe.
        confirmedActions: new Set<string>(),
      });
      for (const tool of definitions.values()) {
        micrositeTools.push(tool);
        registerTool(tool);
      }
    }
  }

  const buildToolMap = (
    loadedSkillIds: string[]
  ): Map<string, ToolDefinition> => {
    const effective = ['default', ...loadedSkillIds];
    const skillToolNames = buildToolListForSkills(effective);
    const map = new Map<string, ToolDefinition>();
    for (const toolName of skillToolNames) {
      const tool = toolCatalogue.get(toolName);
      if (tool) map.set(tool.name, tool);
    }
    // Always include meta tools — independent of loaded skills.
    for (const tool of metaTools) {
      map.set(tool.name, tool);
    }
    // Microsite tools are a toolset, not a skill: when they are switched on
    // for the turn they are all present, exactly as the microsite controller
    // presents them.
    for (const tool of micrositeTools) {
      map.set(tool.name, tool);
    }
    return map;
  };

  // Forced skills bypass `classifyIntent`. `default` is unioned in by
  // `buildToolMap`; persisting skill state is irrelevant for a headless turn.
  const loadedSkillIds = (input.forceSkillIds ?? []).filter(
    (id) => id !== 'default'
  );
  const system = buildSystemBlocks(ctxResult.data, loadedSkillIds);
  const toolMap = buildToolMap(loadedSkillIds);

  const client = createAnthropicClient(apiEnv.ANTHROPIC_API_KEY);

  // Rebuild prior-turn history from the DB, the same way the WhatsApp worker
  // does (chatbot-worker/claire-whatsapp-turn.process.ts). The web chat gets
  // its history from the client, which resends the whole thread; a headless
  // turn has no client, so without this every turn is turn one.
  //
  // That is not a subtle degradation — it made MULTI-TURN EVALS MEANINGLESS.
  // The nightly's two-turn confirm case says "yes, go ahead and create it" on
  // turn 2, and the model received that sentence with no record of what "it"
  // was. It duly guessed a name off the org's service list, and the factory
  // correctly refused with CONFIRMATION_PAYLOAD_MISMATCH — a red run that
  // looked like a Claire regression and was a missing history load.
  //
  // Stored rows → UIMessage[] → Anthropic through the SAME converter the web
  // pipeline uses, so tool_use/tool_result pairing survives. The window is
  // bounded inside `getConversationMessages` (most-recent-N). The current
  // message is persisted AFTER the turn, so it is not in this history — it is
  // appended as the final user turn.
  let history: Anthropic.MessageParam[] = [];
  const historyResult = await getConversationMessages(db, {
    conversationId: input.conversationId,
    organizationId: input.organizationId,
  });
  if (historyResult.success) {
    history = convertStoredToAnthropicMessages(historyResult.data, {
      logger: {
        // eslint-disable-next-line no-console
        warn: (message, ...meta) =>
          console.warn('[runHeadlessTurn]', message, ...meta),
      },
    });
  } else {
    // Best-effort: a load failure degrades to a contextless turn rather than
    // dropping the message entirely.
    logError(
      'assistant.runHeadlessTurn.getConversationMessages',
      new Error(historyResult.error.message),
      {
        feature: 'assistant',
        extra: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
        },
      }
    );
  }

  const initialMessages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: input.messageText },
  ];

  // Drive the shared engine with a CollectingSink instead of SseSink — no UI
  // stream events; the sink accumulates text + tool events in-memory.
  const sink = new CollectingSink();
  const runResult = await runClaireTurn({
    client,
    model: 'claude-sonnet-4-6',
    system,
    initialMessages,
    toolMap,
    toolCtx,
    maxTokens: 4096,
    sink,
    logger: {
      // eslint-disable-next-line no-console
      error: (...args) => console.error('[runHeadlessTurn]', ...args),
      log: () => undefined,
    },
    onSkillsChanged: (newLoadedSkillIds) => ({
      toolMap: buildToolMap(newLoadedSkillIds),
      system: buildSystemBlocks(ctxResult.data, newLoadedSkillIds),
    }),
  });

  const headless = assembleHeadlessTurnResult(sink.collected, runResult);

  // Persist the turn, exactly as the streaming controller does at the end of
  // its own turn (chat/plan-chat-turn.ts step 10) and as the WhatsApp worker
  // does (chatbot-worker/claire-whatsapp-turn.process.ts).
  //
  // WHY THIS IS NOT OPTIONAL BOOKKEEPING: Claire's destructive tools are gated
  // on a TURN BOUNDARY — `verifyConfirmationToken` only releases a token once
  // an INTERVENING USER MESSAGE exists in the conversation, newer than the
  // token (see verify-confirmation-token.service.ts, finding #131). That rule
  // reads persisted `assistant_message` rows.
  //
  // This entry point never wrote any. So a confirmed execute could not be
  // reached headlessly AT ALL: turn 1 issued a token, turn 2 echoed it, and the
  // factory answered `CONFIRMATION_INVALID / no_user_turn` every time, because
  // from the database's point of view the operator had never spoken. The
  // nightly's "services: two-turn confirm creates a service" eval failed on
  // exactly that, indistinguishably from a model that had forgotten the token.
  //
  // Persisting here restores the mirror this file claims: the harness and the
  // controller now agree about what a completed turn leaves behind.
  try {
    await saveMessages(db, {
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      userId: input.userId,
      userMessageContent: input.messageText,
      assistantText: headless.finalText,
      toolCalls: headless.toolParts.length > 0 ? headless.toolParts : undefined,
    });
  } catch (error) {
    // A persistence failure must not swallow the turn's result — the caller
    // still wants the tool trace — but it must be visible, because a silently
    // unpersisted turn is what made the confirmation flow untestable here.
    logError('assistant.runHeadlessTurn.saveMessages', error, {
      feature: 'assistant',
      extra: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
      },
    });
  }

  return {
    conversationId: input.conversationId,
    assistantText: headless.finalText,
    // `toolParts` is engine-authoritative (sink-independent) and carries the
    // full input/output trace tests assert on.
    toolCalls: headless.toolParts.map((part) => ({
      name: part.toolName,
      input: part.input,
      output: part.output,
      errorText: part.errorText,
    })),
    ...(runResult.streamError ? { streamError: runResult.streamError } : {}),
  };
}

/** A throwaway UUID generator for callers that need a synthetic id. */
export function newHeadlessConversationId(): string {
  return randomUUID();
}
