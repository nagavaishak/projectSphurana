import type { RunClaireTurnResult } from './run-claire-turn.js';
import type { TurnSink } from './turn-sink.js';

/**
 * `CollectingSink` — the headless / WhatsApp transport for the Claire tool loop.
 *
 * Where `SseSink` translates each `TurnSink` method into a streaming
 * `UIStreamEvent` for the web `useChat` frontend, `CollectingSink` accumulates
 * the same semantic events into an in-memory structure. Async, one-shot
 * transports (WhatsApp via `render-whatsapp-turn.ts`, headless eval turns)
 * consume the collected result after the loop completes rather than streaming.
 *
 * What it captures:
 *   - **textSegments** — one entry per assistant text block. Deltas are
 *     concatenated per block (keyed by stream id) and flushed into a segment on
 *     `onTextEnd`, preserving the block boundaries the model produced (so the
 *     renderer can map them to separate WhatsApp bubbles if it wants).
 *   - **reasoningSegments** — same, for thinking blocks.
 *   - **toolEvents** — one entry per tool call: the parsed `input` from
 *     `onToolInputAvailable`, the merged `output` (`{ ...data, presentation }`)
 *     from `onToolOutputAvailable` with `presentation` also pulled out for
 *     convenience, or `errorText` from `onToolOutputError`.
 *
 * `stopReason`, `rounds`, and `toolParts` are NOT derived from the sink — the
 * engine returns them on `RunClaireTurnResult` regardless of sink, so they are
 * the authoritative source. Use {@link assembleHeadlessTurnResult} to combine
 * `sink.collected` with the engine's `RunClaireTurnResult` into the final
 * {@link HeadlessTurnResult}.
 */

/** A single tool call captured during a headless turn. */
export interface CollectedToolEvent {
  toolName: string;
  toolCallId: string;
  input?: unknown;
  /** The merged `{ ...data, presentation }` output object (success path). */
  output?: unknown;
  /** Pulled off `output.presentation` for renderer convenience. */
  presentation?: unknown;
  /** Set instead of `output` when the tool threw / was unknown. */
  errorText?: string;
}

/** The data a `CollectingSink` accumulates from the loop (sink-derived only). */
export interface CollectedTurn {
  textSegments: string[];
  toolEvents: CollectedToolEvent[];
  reasoningSegments: string[];
  /** Set if the loop surfaced a turn-level error via `onError`. */
  errorText?: string;
}

/**
 * The full headless turn result: the sink-collected data plus the
 * engine-authoritative `stopReason` / `rounds` / `toolParts` from
 * `RunClaireTurnResult`.
 */
export interface HeadlessTurnResult {
  textSegments: string[];
  toolEvents: CollectedToolEvent[];
  reasoningSegments: string[];
  errorText?: string;
  /** From `RunClaireTurnResult` — sink-independent. */
  stopReason: RunClaireTurnResult['stopReason'];
  rounds: number;
  toolParts: RunClaireTurnResult['toolParts'];
  finalText: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export class CollectingSink implements TurnSink {
  private readonly textSegments: string[] = [];
  private readonly reasoningSegments: string[] = [];
  private readonly toolEvents: CollectedToolEvent[] = [];
  private errorText: string | undefined;

  /** In-flight text/reasoning blocks, keyed by stream id. */
  private readonly openText = new Map<string, string>();
  private readonly openReasoning = new Map<string, string>();
  /** Tool events in flight, keyed by toolCallId, for O(1) output updates. */
  private readonly toolIndex = new Map<string, number>();

  onStepStart(): void {}
  onStepFinish(): void {}

  onTextStart(args: { id: string }): void {
    this.openText.set(args.id, '');
  }

  onTextDelta(args: { id: string; delta: string }): void {
    this.openText.set(args.id, (this.openText.get(args.id) ?? '') + args.delta);
  }

  onTextEnd(args: { id: string }): void {
    const text = this.openText.get(args.id);
    this.openText.delete(args.id);
    if (text && text.length > 0) this.textSegments.push(text);
  }

  onReasoningStart(args: { id: string }): void {
    this.openReasoning.set(args.id, '');
  }

  onReasoningDelta(args: { id: string; delta: string }): void {
    this.openReasoning.set(
      args.id,
      (this.openReasoning.get(args.id) ?? '') + args.delta
    );
  }

  onReasoningEnd(args: { id: string }): void {
    const text = this.openReasoning.get(args.id);
    this.openReasoning.delete(args.id);
    if (text && text.length > 0) this.reasoningSegments.push(text);
  }

  onToolInputStart(_args: {
    toolCallId: string;
    toolName: string;
    providerExecuted?: boolean;
  }): void {}

  onToolInputDelta(_args: {
    toolCallId: string;
    inputTextDelta: string;
  }): void {}

  onToolInputAvailable(args: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
  }): void {
    this.toolIndex.set(args.toolCallId, this.toolEvents.length);
    this.toolEvents.push({
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      input: args.input,
    });
  }

  onToolOutputAvailable(args: {
    toolCallId: string;
    output: unknown;
    providerExecuted?: boolean;
  }): void {
    const presentation = isRecord(args.output)
      ? args.output.presentation
      : undefined;
    const idx = this.toolIndex.get(args.toolCallId);
    if (idx !== undefined && this.toolEvents[idx]) {
      this.toolEvents[idx].output = args.output;
      if (presentation !== undefined) {
        this.toolEvents[idx].presentation = presentation;
      }
    } else {
      // Defensive: output without a preceding input-available frame.
      this.toolEvents.push({
        toolName: 'unknown',
        toolCallId: args.toolCallId,
        output: args.output,
        ...(presentation !== undefined ? { presentation } : {}),
      });
    }
  }

  onToolOutputError(args: {
    toolCallId: string;
    errorText: string;
    providerExecuted?: boolean;
  }): void {
    const idx = this.toolIndex.get(args.toolCallId);
    if (idx !== undefined && this.toolEvents[idx]) {
      this.toolEvents[idx].errorText = args.errorText;
    } else {
      this.toolEvents.push({
        toolName: 'unknown',
        toolCallId: args.toolCallId,
        errorText: args.errorText,
      });
    }
  }

  onError(args: { errorText: string }): void {
    this.errorText = args.errorText;
  }

  /** The sink-derived accumulation (not yet combined with the run result). */
  get collected(): CollectedTurn {
    return {
      textSegments: this.textSegments,
      toolEvents: this.toolEvents,
      reasoningSegments: this.reasoningSegments,
      errorText: this.errorText,
    };
  }
}

/**
 * Combine a `CollectingSink`'s accumulation with the engine's
 * `RunClaireTurnResult` (the authoritative source of `stopReason`, `rounds`,
 * `toolParts`, `finalText`) into the final {@link HeadlessTurnResult}.
 */
export function assembleHeadlessTurnResult(
  collected: CollectedTurn,
  runResult: RunClaireTurnResult
): HeadlessTurnResult {
  return {
    textSegments: collected.textSegments,
    toolEvents: collected.toolEvents,
    reasoningSegments: collected.reasoningSegments,
    ...(collected.errorText !== undefined
      ? { errorText: collected.errorText }
      : {}),
    stopReason: runResult.stopReason,
    rounds: runResult.rounds,
    toolParts: runResult.toolParts,
    finalText: runResult.finalText,
  };
}
