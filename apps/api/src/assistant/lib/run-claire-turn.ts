import { randomUUID } from 'node:crypto';
import { classifyStreamError } from '@borradh-workspace/ai';
import type { Anthropic } from '@borradh-workspace/ai';
import {
  captureAiGeneration,
  logError,
} from '@borradh-workspace/observability';
import type {
  AssistantToolsContext,
  ToolDefinition,
} from '../tool-factory/index.js';
import type { TurnSink } from './turn-sink.js';

/**
 * Transport-agnostic per-turn tool-use loop for direct Anthropic SDK calls.
 *
 * This is the core Claire engine extracted from `manual-tool-loop.ts`. The
 * loop body is unchanged except that every `emit({ type: 'x', ... })` call is
 * replaced by the matching semantic `sink.onX(...)` call on a `TurnSink`. The
 * two sinks (`SseSink` for web, `CollectingSink` for WhatsApp) translate those
 * semantic events into their respective transports; the engine never touches
 * SSE or WhatsApp directly.
 *
 * The Anthropic SDK's streaming endpoint emits `RawMessageStreamEvent`s —
 * `message_start`, `content_block_start`, `content_block_delta`,
 * `content_block_stop`, `message_delta`, `message_stop` — which we translate
 * to semantic sink events.
 *
 * Tool-use semantics (from the Anthropic docs):
 *   - `content_block_start` opens a `tool_use` block (no input yet).
 *   - One or more `content_block_delta` events with `input_json_delta` carry
 *     the streaming JSON args.
 *   - `content_block_stop` closes the block — at that point we parse the
 *     accumulated JSON and dispatch the tool.
 *   - The model's `stop_reason` tells us whether to feed `tool_result`s back
 *     and continue (`tool_use`) or finish the turn (`end_turn`).
 *
 * After every `tool_use` round, we open a fresh `client.messages.stream`
 * with the prior assistant message + new user `tool_result`s appended.
 * Cap at `MAX_ROUNDS` rounds per turn — sufficient for any real flow,
 * defensive against runaway loops if the model ignores the stop signal.
 */

const MAX_ROUNDS = 10;

export interface RunClaireTurnParams {
  client: Anthropic;
  model: 'claude-sonnet-4-6' | 'claude-opus-4-7';
  /** System prompt blocks (already shaped with cache_control on the stable
   *  blocks). Passed verbatim to every round unless `onSkillsChanged` swaps
   *  it after a `meta_loadSkill` mid-turn (see below). */
  system: Anthropic.TextBlockParam[];
  /** Initial messages for round 1. Subsequent rounds append the assistant
   *  message and any `tool_result` blocks. */
  initialMessages: Anthropic.MessageParam[];
  /** Map of `tool.name` → `ToolDefinition` (factory-shaped + legacy-shimmed
   *  alike). The dispatcher looks tools up by the model's `tool_use.name`. */
  toolMap: Map<string, ToolDefinition>;
  /** The factory's per-call execution context (counter, apiFetch, confirmation
   *  helpers, etc.). One instance per chat request, shared across rounds. */
  toolCtx: AssistantToolsContext;
  /** Anthropic max_tokens per round. */
  maxTokens: number;
  /** Optional thinking config — wired off for v3 v1 cutover; per-skill
   *  enable lands in W-C03-D. */
  thinking?: Anthropic.ThinkingConfigParam;
  /** Transport sink — receives every semantic turn event. The engine never
   *  touches SSE/WhatsApp directly; the sink translates to the transport. */
  sink: TurnSink;
  /** Logger. */
  logger: {
    error: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
  };
  /**
   * Optional mid-turn rebuild hook (W-C03-D-finish).
   *
   * When the model calls `meta_loadSkill` and the tool reports success with
   * a `currentLoadedSkills` array, the loop calls this hook. The controller
   * rebuilds the tool catalogue + orchestrator system blocks for the new
   * loaded-skill set and returns them; the loop swaps both in for the next
   * round of the same turn so the freshly-loaded skill's tools are
   * immediately reachable. Block 1 + 2 of the orchestrator stay stable so
   * cache hits survive; only Block 3 churns.
   *
   * If undefined, mid-turn skill changes are deferred to the next user
   * send — the model can still call `load_skill` but won't see the new
   * tools until the next turn.
   */
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
 * Persisted shape for a single tool call + its result. The chat-history
 * hydrator (`convertStoredToUIMessages` in apps/app) rebuilds AI SDK v5
 * `tool-<toolName>` parts from this list so refresh / back-navigate
 * preserves every preview card, loading tile, and confirmation button.
 */
export interface PersistedToolPart {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}

/** Classified Anthropic stream failure (rate limit, auth, network, etc.).
 *  Attached to the result when a round's SDK stream throws so callers can
 *  distinguish a hard API failure from a clean no-tool response. */
export interface StreamErrorSignal {
  category: 'transient' | 'terminal' | 'unknown';
  httpStatus?: number;
  apiErrorType?: string;
  message: string;
}

export interface RunClaireTurnResult {
  /** Concatenated assistant text from the final round (used by the existing
   *  `saveMessages` call to persist the response). */
  finalText: string;
  /** Total number of rounds executed (1 = no tool use). */
  rounds: number;
  /** Last `stop_reason` returned by Anthropic. */
  stopReason: Anthropic.StopReason | null;
  /** All tool calls + outputs emitted across every round, in emission
   *  order. Passed verbatim to `saveMessages.toolCalls` so the chat-history
   *  hydrator can rebuild AI SDK part shapes on next conversation load. */
  toolParts: PersistedToolPart[];
  /** Set when the Anthropic SDK stream threw (rate limit, auth, network).
   *  Absent on a normal turn — callers check `result.streamError` to
   *  distinguish a hard API failure from a clean no-tool response. */
  streamError?: StreamErrorSignal;
}

/** Build the Anthropic `tools` array from the dispatch map. */
export function buildAnthropicToolList(
  toolMap: Map<string, ToolDefinition>
): Anthropic.Tool[] {
  return Array.from(toolMap.values()).map((tool) => {
    const def = tool.toAnthropicDefinition();
    return {
      name: def.name,
      description: def.description,
      input_schema: def.input_schema as Anthropic.Tool['input_schema'],
    };
  });
}

/**
 * Drive a single chat turn through Anthropic, dispatching tools manually
 * and forwarding everything to the supplied `TurnSink`.
 */
export async function runClaireTurn(
  params: RunClaireTurnParams
): Promise<RunClaireTurnResult> {
  const {
    client,
    model,
    initialMessages,
    toolCtx,
    maxTokens,
    thinking,
    sink,
    logger,
    onSkillsChanged,
    observability,
  } = params;

  // System + toolMap may be swapped mid-turn via `onSkillsChanged`. Track
  // them mutably; the Anthropic `tools` array is recomputed alongside.
  let system = params.system;
  let toolMap = params.toolMap;
  let tools = buildAnthropicToolList(toolMap);
  const messages: Anthropic.MessageParam[] = [...initialMessages];

  let rounds = 0;
  let finalText = '';
  let stopReason: Anthropic.StopReason | null = null;
  let streamErrorSignal: StreamErrorSignal | undefined;
  // Accumulated across all rounds — flushed into `saveMessages.toolCalls`
  // by the controller so refresh / back-navigate rehydrates every preview
  // card, loading tile, and confirmation button. Keyed by `toolCallId` for
  // O(1) output-side updates.
  const toolParts: PersistedToolPart[] = [];
  const toolPartIndex = new Map<string, number>();

  while (rounds < MAX_ROUNDS) {
    rounds += 1;

    // ── Open one streaming turn with Anthropic ───────────────────────────
    // Snapshot this round's input + start time for the $ai_generation event
    // captured after the stream completes (client-level instrumentation skips
    // streaming because usage only arrives at the end).
    const roundInputMessages = [...messages];
    const roundStart = Date.now();

    // Buffers for the current message's content blocks. Indexed by the
    // `index` field on each `content_block_*` event.
    interface ContentBuffer {
      // text or thinking
      type: 'text' | 'thinking' | 'tool_use' | 'other';
      // text/thinking accumulator
      text: string;
      // thinking signature (received as a SignatureDelta; required to feed
      // a thinking block back to Anthropic)
      signature?: string;
      // tool_use accumulator
      toolName?: string;
      toolUseId?: string;
      toolInputJson: string;
      // streaming UI ID (for text/reasoning chunks)
      streamId?: string;
      uiOpened?: boolean;
    }
    const blocks = new Map<number, ContentBuffer>();
    const assistantContent: Anthropic.ContentBlockParam[] = [];
    const toolResultsForNextRound: Anthropic.ContentBlockParam[] = [];
    let roundText = '';

    sink.onStepStart();

    try {
      // Open the stream INSIDE the try so a synchronous throw from the SDK
      // (e.g. a rate-limit error raised before the first event) is classified
      // and surfaced like any mid-stream failure, rather than escaping the loop.
      const stream = client.messages.stream({
        model,
        system,
        messages,
        tools,
        max_tokens: maxTokens,
        ...(thinking ? { thinking } : {}),
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            // Nothing to forward to the UI — the controller already emitted
            // `start` before the loop began.
            break;
          }
          case 'content_block_start': {
            const idx = event.index;
            const block = event.content_block;
            if (block.type === 'text') {
              const id = randomUUID();
              blocks.set(idx, {
                type: 'text',
                text: '',
                streamId: id,
                toolInputJson: '',
              });
              sink.onTextStart({ id });
            } else if (block.type === 'thinking') {
              const id = randomUUID();
              blocks.set(idx, {
                type: 'thinking',
                text: '',
                streamId: id,
                toolInputJson: '',
              });
              sink.onReasoningStart({ id });
            } else if (block.type === 'tool_use') {
              blocks.set(idx, {
                type: 'tool_use',
                text: '',
                toolName: block.name,
                toolUseId: block.id,
                toolInputJson: '',
              });
              sink.onToolInputStart({
                toolCallId: block.id,
                toolName: block.name,
                providerExecuted: true,
              });
            } else {
              blocks.set(idx, {
                type: 'other',
                text: '',
                toolInputJson: '',
              });
            }
            break;
          }
          case 'content_block_delta': {
            const idx = event.index;
            const buf = blocks.get(idx);
            if (!buf) break;
            const delta = event.delta;
            if (delta.type === 'text_delta' && buf.type === 'text') {
              buf.text += delta.text;
              roundText += delta.text;
              if (buf.streamId) {
                sink.onTextDelta({
                  id: buf.streamId,
                  delta: delta.text,
                });
              }
            } else if (
              delta.type === 'thinking_delta' &&
              buf.type === 'thinking'
            ) {
              buf.text += delta.thinking;
              if (buf.streamId) {
                sink.onReasoningDelta({
                  id: buf.streamId,
                  delta: delta.thinking,
                });
              }
            } else if (
              delta.type === 'signature_delta' &&
              buf.type === 'thinking'
            ) {
              buf.signature = (buf.signature ?? '') + delta.signature;
            } else if (
              delta.type === 'input_json_delta' &&
              buf.type === 'tool_use'
            ) {
              buf.toolInputJson += delta.partial_json;
              if (buf.toolUseId) {
                sink.onToolInputDelta({
                  toolCallId: buf.toolUseId,
                  inputTextDelta: delta.partial_json,
                });
              }
            }
            break;
          }
          case 'content_block_stop': {
            const idx = event.index;
            const buf = blocks.get(idx);
            if (!buf) break;
            if (buf.type === 'text') {
              if (buf.streamId) sink.onTextEnd({ id: buf.streamId });
              if (buf.text.length > 0) {
                assistantContent.push({ type: 'text', text: buf.text });
              }
            } else if (buf.type === 'thinking') {
              if (buf.streamId) sink.onReasoningEnd({ id: buf.streamId });
              if (buf.text.length > 0 && buf.signature) {
                assistantContent.push({
                  type: 'thinking',
                  thinking: buf.text,
                  signature: buf.signature,
                });
              }
            } else if (
              buf.type === 'tool_use' &&
              buf.toolName &&
              buf.toolUseId
            ) {
              // Parse the streamed JSON args. Empty JSON ('') = empty object.
              let parsedInput: unknown = {};
              if (buf.toolInputJson.length > 0) {
                try {
                  parsedInput = JSON.parse(buf.toolInputJson);
                } catch (parseError) {
                  logger.error('Tool input JSON parse failed', {
                    toolName: buf.toolName,
                    toolUseId: buf.toolUseId,
                    error: parseError,
                  });
                  parsedInput = {};
                }
              }

              sink.onToolInputAvailable({
                toolCallId: buf.toolUseId,
                toolName: buf.toolName,
                input: parsedInput,
                providerExecuted: true,
              });

              // Persist for chat-history hydration. Output is filled in
              // below when the tool execution returns.
              toolPartIndex.set(buf.toolUseId, toolParts.length);
              toolParts.push({
                toolCallId: buf.toolUseId,
                toolName: buf.toolName,
                input: parsedInput,
              });

              // Record the assistant's tool_use for the next round.
              assistantContent.push({
                type: 'tool_use',
                id: buf.toolUseId,
                name: buf.toolName,
                input: parsedInput as Record<string, unknown>,
              });

              // Dispatch the tool — the factory handles counter, validation,
              // confirmation, hard-blocks, sanitization. We only report.
              const tool = toolMap.get(buf.toolName);
              if (!tool) {
                const errMsg = `Unknown tool: ${buf.toolName}`;
                sink.onToolOutputError({
                  toolCallId: buf.toolUseId,
                  errorText: errMsg,
                  providerExecuted: true,
                });
                const idx = toolPartIndex.get(buf.toolUseId);
                if (idx !== undefined && toolParts[idx]) {
                  toolParts[idx].errorText = errMsg;
                }
                toolResultsForNextRound.push({
                  type: 'tool_result',
                  tool_use_id: buf.toolUseId,
                  content: errMsg,
                  is_error: true,
                });
                break;
              }

              try {
                const result = await tool.execute(parsedInput, toolCtx);
                if (result.ok) {
                  // The model sees the data + presentation envelope as one
                  // JSON blob; the frontend renderer decodes the
                  // presentation block off of `output`.
                  const output: Record<string, unknown> = {
                    ...((result.data as Record<string, unknown>) ?? {}),
                  };
                  if (result.presentation) {
                    output.presentation = result.presentation;
                  }
                  sink.onToolOutputAvailable({
                    toolCallId: buf.toolUseId,
                    output,
                    providerExecuted: true,
                  });
                  const idx = toolPartIndex.get(buf.toolUseId);
                  if (idx !== undefined && toolParts[idx]) {
                    toolParts[idx].output = output;
                  }
                  toolResultsForNextRound.push({
                    type: 'tool_result',
                    tool_use_id: buf.toolUseId,
                    content: JSON.stringify(output),
                  });

                  // Mid-turn skill rebuild (W-C03-D-finish). When the
                  // model calls `meta_loadSkill` and the persistence
                  // service returns `currentLoadedSkills`, swap the
                  // tool list + system blocks for the next round so
                  // the freshly-loaded skill's tools are reachable
                  // immediately. Block 1 + 2 of the orchestrator stay
                  // stable; only Block 3 churns. We accept the cache
                  // miss on Block 3 — `load_skill` is rare (typically
                  // once per conversation, max).
                  if (
                    onSkillsChanged &&
                    buf.toolName === 'meta_loadSkill' &&
                    typeof output.loaded === 'boolean' &&
                    output.loaded === true &&
                    Array.isArray(output.currentLoadedSkills)
                  ) {
                    const nextLoaded = (
                      output.currentLoadedSkills as unknown[]
                    ).filter((id): id is string => typeof id === 'string');
                    try {
                      const rebuilt = onSkillsChanged(nextLoaded);
                      toolMap = rebuilt.toolMap;
                      system = rebuilt.system;
                      tools = buildAnthropicToolList(toolMap);
                    } catch (rebuildError) {
                      // Don't fail the turn — log and continue with the
                      // pre-rebuild tool set. The model still gets the
                      // tool_result for `meta_loadSkill` and can reason
                      // about the situation; the new skill's tools will
                      // simply be unavailable until next user send.
                      logger.error('Skill rebuild failed', {
                        error: rebuildError,
                      });
                    }
                  }
                } else {
                  // Sanitized error (factory guarantees this is safe to
                  // surface to the model and the user).
                  const errPayload: Record<string, unknown> = {
                    error: result.error,
                  };
                  if (result.code) errPayload.code = result.code;
                  if (result.presentation) {
                    errPayload.presentation = result.presentation;
                  }
                  sink.onToolOutputAvailable({
                    toolCallId: buf.toolUseId,
                    output: errPayload,
                    providerExecuted: true,
                  });
                  const idx = toolPartIndex.get(buf.toolUseId);
                  if (idx !== undefined && toolParts[idx]) {
                    toolParts[idx].output = errPayload;
                  }
                  toolResultsForNextRound.push({
                    type: 'tool_result',
                    tool_use_id: buf.toolUseId,
                    content: JSON.stringify(errPayload),
                    is_error: true,
                  });
                }
              } catch (executionError) {
                logger.error('Tool execution threw', {
                  toolName: buf.toolName,
                  toolUseId: buf.toolUseId,
                  error: executionError,
                });
                const errMsg = 'Something went wrong running that tool.';
                sink.onToolOutputError({
                  toolCallId: buf.toolUseId,
                  errorText: errMsg,
                  providerExecuted: true,
                });
                const idx = toolPartIndex.get(buf.toolUseId);
                if (idx !== undefined && toolParts[idx]) {
                  toolParts[idx].errorText = errMsg;
                }
                toolResultsForNextRound.push({
                  type: 'tool_result',
                  tool_use_id: buf.toolUseId,
                  content: errMsg,
                  is_error: true,
                });
              }
            }
            blocks.delete(idx);
            break;
          }
          case 'message_delta': {
            stopReason = event.delta.stop_reason ?? stopReason;
            break;
          }
          case 'message_stop': {
            // Final message event — captured via finalMessage() below for
            // any deltas we may have missed. The buffers were all closed
            // by content_block_stop.
            break;
          }
          default: {
            // SDK may surface additional event types in future versions.
            break;
          }
        }
      }

      // Pull the finalized message from the SDK helper for stop_reason
      // certainty (the streamed `message_delta` events are the source of
      // truth, but the helper consolidates).
      const finalMsg = await stream.finalMessage();
      stopReason = finalMsg.stop_reason ?? stopReason;

      // PostHog LLM observability — one $ai_generation per streamed round.
      captureAiGeneration({
        provider: 'anthropic',
        model: finalMsg.model ?? model,
        spanName: observability?.spanName ?? 'assistant.runClaireTurn',
        distinctId: observability?.distinctId,
        traceId: observability?.traceId,
        groups: observability?.organizationId
          ? { organization: observability.organizationId }
          : undefined,
        input: roundInputMessages,
        outputChoices: [{ role: 'assistant', content: finalMsg.content }],
        inputTokens: finalMsg.usage?.input_tokens,
        outputTokens: finalMsg.usage?.output_tokens,
        cacheReadInputTokens:
          finalMsg.usage?.cache_read_input_tokens ?? undefined,
        cacheCreationInputTokens:
          finalMsg.usage?.cache_creation_input_tokens ?? undefined,
        latencySeconds: (Date.now() - roundStart) / 1000,
        maxTokens,
        properties: { round: rounds },
      });
    } catch (caughtStreamError) {
      const classified = classifyStreamError(caughtStreamError);
      streamErrorSignal = {
        category: classified.category,
        httpStatus: classified.httpStatus,
        apiErrorType: classified.apiErrorType,
        message: classified.message,
      };
      logger.error('Anthropic stream failed', { error: caughtStreamError });
      captureAiGeneration({
        provider: 'anthropic',
        model,
        spanName: observability?.spanName ?? 'assistant.runClaireTurn',
        distinctId: observability?.distinctId,
        traceId: observability?.traceId,
        groups: observability?.organizationId
          ? { organization: observability.organizationId }
          : undefined,
        input: roundInputMessages,
        latencySeconds: (Date.now() - roundStart) / 1000,
        maxTokens,
        isError: true,
        error:
          caughtStreamError instanceof Error
            ? caughtStreamError.message
            : String(caughtStreamError),
        properties: {
          round: rounds,
          errorCategory: classified.category,
          errorHttpStatus: classified.httpStatus,
          errorApiType: classified.apiErrorType,
        },
      });
      logError('assistant.toolLoop.streamFailed', caughtStreamError, {
        feature: 'assistant',
        user: { id: toolCtx.userId },
        extra: {
          organizationId: toolCtx.organizationId,
          conversationId: toolCtx.conversationId,
          errorCategory: classified.category,
          errorHttpStatus: classified.httpStatus,
          errorApiType: classified.apiErrorType,
        },
      });
      sink.onError({
        errorText: 'Something went wrong. Please try again in a moment.',
      });
      sink.onStepFinish();
      break;
    }

    sink.onStepFinish();

    // Append the assistant turn we just received (text + thinking + tool_use).
    if (assistantContent.length > 0) {
      messages.push({ role: 'assistant', content: assistantContent });
    }

    if (stopReason === 'tool_use' && toolResultsForNextRound.length > 0) {
      // Feed tool_result blocks back as a synthetic user turn and loop.
      messages.push({ role: 'user', content: toolResultsForNextRound });
      finalText = roundText; // running tally; final round overwrites
      continue;
    }

    finalText = roundText;
    break;
  }

  return {
    finalText,
    rounds,
    stopReason,
    toolParts,
    streamError: streamErrorSignal,
  };
}
