/**
 * One microsite chat turn, end to end.
 *
 * The shape follows Claire's `plan-chat-turn.ts`: the use case decides
 * everything (reject with a status, or open a stream and drive it) and never
 * touches the `Response`. The controller is transport only.
 *
 * Three things are worth knowing before changing this file:
 *
 *   1. The tool loop is Claire's (`runToolLoop` → `runClaireTurn`). This is
 *      Claire with a different toolset, not a second AI stack.
 *   2. `micrositeId` and `organizationId` come from the ROUTE and the SESSION.
 *      They are put on the tool context once, here, and no tool schema carries
 *      them — so a model cannot name another tenant's site, and the services
 *      re-check ownership with a WHERE clause regardless.
 *   3. Exactly one revision is written per mutating turn, by
 *      `completeMicrositeTurn`, after the model is done — never inside the
 *      loop, and never around it (a transaction held across model I/O is what
 *      saturated the pool in the meta-sync incident).
 */

import { createAnthropicClient } from '@borradh-workspace/ai';
import type { Anthropic } from '@borradh-workspace/ai';
import { db } from '@borradh-workspace/database';
import type { MicrositeToolCall } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type BeganMicrositeTurn,
  EMPTY_MICROSITE_DIFF,
  type MicrositeAgentSession,
  beginMicrositeTurn,
  completeMicrositeTurn,
  createTurnBudget,
} from '@borradh-workspace/features/microsites';
// `runClaireTurn` is the engine; `runToolLoop` (manual-tool-loop.ts) is its
// SSE-shim, which builds an `SseSink` from an `emit` callback and would emit
// the AI SDK vocabulary. We drive the same engine with our own sink — exactly
// what `CollectingSink` (WhatsApp) does. One loop, two vocabularies.
import { runClaireTurn } from '../../assistant/lib/run-claire-turn.js';
import { buildAssistantToolsContext } from '../../assistant/tool-factory/index.js';
import {
  type MicrositeStreamEvent,
  MicrositeTurnSink,
} from './microsite-stream.js';
import { buildMicrositeToolDefinitions } from './microsite-tool-definitions.js';

/** Socket timeout for the stream — a long edit is still one HTTP request. */
export const MICROSITE_STREAM_TIMEOUT_MS = 5 * 60 * 1000;

const MAX_TOKENS = 4096;

export interface MicrositeChatBody {
  /** The user's message. Named `prompt` because that is what the sidebar sends. */
  prompt: string;
  conversationId?: string;
  /** What the user has selected in the canvas — scopes the turn to that block. */
  selection?: { pageId?: string; blockId: string };
  /**
   * Destructive actions the USER confirmed in the sidebar, echoed back from a
   * previous `tool` event's `confirmation.action`. The model has no way to
   * produce these — that is the point (contract §3).
   */
  confirmedActions?: string[];
}

export interface MicrositeStreamWriter {
  emit: (event: MicrositeStreamEvent) => void;
  close: () => void;
}

export type MicrositeChatPlan =
  | { kind: 'reject'; status: number; body: unknown }
  | { kind: 'stream'; run: (writer: MicrositeStreamWriter) => Promise<void> };

interface PlanInput {
  body: MicrositeChatBody;
  micrositeId: string;
  organizationId: string;
  userId: string;
  logger: {
    error: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

export async function planMicrositeChatTurn(
  input: PlanInput
): Promise<MicrositeChatPlan> {
  if (!apiEnv.ANTHROPIC_API_KEY) {
    return {
      kind: 'reject',
      status: 503,
      body: { message: 'The website assistant is not available right now' },
    };
  }

  const session: MicrositeAgentSession = {
    micrositeId: input.micrositeId,
    organizationId: input.organizationId,
    userId: input.userId,
  };

  // Resolve the conversation, store the user's message and assemble the
  // context BEFORE opening the stream, so a bad request is a plain HTTP
  // status rather than an SSE frame the sidebar has to special-case.
  const begun = await beginMicrositeTurn(db, {
    session,
    conversationId: input.body.conversationId,
    message: input.body.prompt ?? '',
    selectedBlockId: input.body.selection?.blockId,
  });
  if (!begun.success) {
    return {
      kind: 'reject',
      status: STATUS_BY_CODE[begun.error.code] ?? 500,
      body: { message: begun.error.message, code: begun.error.code },
    };
  }

  return {
    kind: 'stream',
    run: (writer) => driveTurn(input, session, begun.data, writer),
  };
}

async function driveTurn(
  input: PlanInput,
  session: MicrositeAgentSession,
  turn: BeganMicrositeTurn,
  writer: MicrositeStreamWriter
): Promise<void> {
  const toolCalls: MicrositeToolCall[] = [];

  const sink = new MicrositeTurnSink(writer.emit, (result) => {
    toolCalls.push({
      id: result.toolCallId,
      name: result.toolName,
      args: (result.input as Record<string, unknown>) ?? {},
      result: result.output,
      error: result.errorText,
    });
  });

  const toolMap = buildMicrositeToolDefinitions({
    db,
    session,
    budget: createTurnBudget(),
    confirmedActions: new Set(input.body.confirmedActions ?? []),
  });

  const messages: Anthropic.MessageParam[] = [
    ...turn.history.map((message) => ({
      role:
        message.role === 'assistant'
          ? ('assistant' as const)
          : ('user' as const),
      content: message.content,
    })),
    { role: 'user' as const, content: input.body.prompt },
  ];

  let assistantText = '';
  let failed: string | null = null;

  try {
    const result = await runClaireTurn({
      client: createAnthropicClient(apiEnv.ANTHROPIC_API_KEY as string),
      model: 'claude-sonnet-4-6',
      system: [{ type: 'text', text: turn.systemText }],
      initialMessages: messages,
      toolMap,
      // Unused by microsite tools — see microsite-tool-definitions.ts. Built
      // rather than faked so a future tool that DOES need it finds a real one.
      toolCtx: buildAssistantToolsContext({
        organizationId: session.organizationId,
        userId: session.userId,
        conversationId: turn.conversationId,
        port: apiEnv.PORT,
      }),
      maxTokens: MAX_TOKENS,
      sink,
      logger: input.logger,
      observability: {
        distinctId: session.userId,
        organizationId: session.organizationId,
        traceId: turn.conversationId,
        spanName: 'microsites.agentTurn',
      },
    });
    assistantText = result.finalText;
    if (result.streamError) failed = result.streamError.message;
  } catch (error) {
    input.logger.error('[microsites.chat] turn failed', error);
    failed = 'The website assistant could not finish that edit.';
  }

  // The revision is written even when the model failed mid-turn: the draft may
  // already have changed, and an edit with no revision is an edit that cannot
  // be undone.
  const completed = await completeMicrositeTurn(db, {
    session,
    turn,
    assistantText: assistantText || (failed ?? ''),
    toolCalls,
  });

  if (failed) writer.emit({ type: 'error', message: failed });

  if (!completed.success) {
    input.logger.error(
      '[microsites.chat] could not persist turn',
      completed.error
    );
    writer.emit({ type: 'error', message: completed.error.message });
    writer.emit({
      type: 'done',
      revisionId: null,
      diff: EMPTY_MICROSITE_DIFF,
      conversationId: turn.conversationId,
    });
    writer.close();
    return;
  }

  writer.emit({
    type: 'done',
    revisionId: completed.data.revisionId,
    diff: completed.data.diff,
    conversationId: turn.conversationId,
  });
  writer.close();
}
