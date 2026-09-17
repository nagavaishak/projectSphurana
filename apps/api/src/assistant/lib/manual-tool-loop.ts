import type { Anthropic } from '@borradh-workspace/ai';
import type {
  AssistantToolsContext,
  ToolDefinition,
} from '../tool-factory/index.js';
import { type UIStreamEvent } from './emit-ui-stream-event.js';
import {
  type PersistedToolPart,
  type RunClaireTurnResult,
  type StreamErrorSignal,
  buildAnthropicToolList,
  runClaireTurn,
} from './run-claire-turn.js';
import { SseSink } from './sse-sink.js';

/**
 * Thin compatibility shim over the transport-agnostic Claire engine
 * (`run-claire-turn.ts`).
 *
 * Historically this file *was* the loop, welded to SSE via an `emit`
 * callback. WS-1 inverted that dependency: the loop now drives a `TurnSink`,
 * and SSE is just one sink (`SseSink`). This shim preserves the original
 * `runToolLoop` signature (with `emit`) so existing importers — chiefly
 * `assistant-chat.controller.ts` — keep working byte-identically: it simply
 * constructs `new SseSink(emit)` and delegates to `runClaireTurn`.
 *
 * `PersistedToolPart`, `RunToolLoopResult`, and `buildAnthropicToolList` are
 * re-exported for the same reason.
 */

export type { PersistedToolPart, StreamErrorSignal };
export { buildAnthropicToolList };

/** @deprecated Prefer `RunClaireTurnResult` from `run-claire-turn.ts`. */
export type RunToolLoopResult = RunClaireTurnResult;

interface RunToolLoopParams {
  client: Anthropic;
  model: 'claude-sonnet-4-6' | 'claude-opus-4-7';
  system: Anthropic.TextBlockParam[];
  initialMessages: Anthropic.MessageParam[];
  toolMap: Map<string, ToolDefinition>;
  toolCtx: AssistantToolsContext;
  maxTokens: number;
  thinking?: Anthropic.ThinkingConfigParam;
  /** SSE writer — receives every UI stream event the controller forwards
   *  to the client. Wrapped in an `SseSink` and handed to `runClaireTurn`. */
  emit: (event: UIStreamEvent) => void;
  logger: {
    error: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
  };
  onSkillsChanged?: (newLoadedSkillIds: string[]) => {
    toolMap: Map<string, ToolDefinition>;
    system: Anthropic.TextBlockParam[];
  };
  /**
   * Optional PostHog LLM-observability attribution. When provided, each
   * streamed round emits a `$ai_generation` event tagged with the acting user
   * (`distinctId`), the organization group, and a `traceId` (the conversation
   * id) so all turns of a conversation group into one PostHog trace. When
   * omitted, attribution falls back to the ambient observability context.
   */
  observability?: {
    distinctId?: string;
    organizationId?: string;
    traceId?: string;
    spanName?: string;
  };
}

/**
 * Drive a single chat turn through Anthropic over SSE. Constructs an
 * `SseSink` from `emit` and delegates to the transport-agnostic engine.
 */
export async function runToolLoop(
  params: RunToolLoopParams
): Promise<RunToolLoopResult> {
  const { emit, ...rest } = params;
  return runClaireTurn({ ...rest, sink: new SseSink(emit) });
}
