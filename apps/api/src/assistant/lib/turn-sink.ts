/**
 * `TurnSink` — the transport seam for the Claire tool loop.
 *
 * The core loop (`run-claire-turn.ts`) is transport-agnostic: instead of
 * emitting `UIStreamEvent`s directly to an SSE response, it calls semantic
 * methods on a `TurnSink`. Each method corresponds 1:1 to an event the loop
 * historically emitted via `emit({ type: 'x', ... })`.
 *
 * Two implementations exist:
 *   - `SseSink` (web) — maps every method back to today's exact `UIStreamEvent`
 *     so the wire output is byte-identical to the pre-refactor loop.
 *   - `CollectingSink` (WhatsApp, WS-2) — accumulates a structured result for
 *     async, one-shot, text+media transports.
 *
 * The payload fields below mirror the fields the loop passed to `emit` exactly.
 */
export interface TurnSink {
  /** Begin a new model round (was `emit({ type: 'start-step' })`). */
  onStepStart(): void;
  /** End a model round (was `emit({ type: 'finish-step' })`). */
  onStepFinish(): void;

  /** A text content block opened (was `emit({ type: 'text-start', id })`). */
  onTextStart(args: { id: string }): void;
  /** A text delta (was `emit({ type: 'text-delta', id, delta })`). */
  onTextDelta(args: { id: string; delta: string }): void;
  /** A text content block closed (was `emit({ type: 'text-end', id })`). */
  onTextEnd(args: { id: string }): void;

  /** A thinking block opened (was `emit({ type: 'reasoning-start', id })`). */
  onReasoningStart(args: { id: string }): void;
  /** A thinking delta (was `emit({ type: 'reasoning-delta', id, delta })`). */
  onReasoningDelta(args: { id: string; delta: string }): void;
  /** A thinking block closed (was `emit({ type: 'reasoning-end', id })`). */
  onReasoningEnd(args: { id: string }): void;

  /**
   * A tool_use block opened (was `emit({ type: 'tool-input-start',
   * toolCallId, toolName, providerExecuted: true })`).
   */
  onToolInputStart(args: {
    toolCallId: string;
    toolName: string;
    providerExecuted?: boolean;
  }): void;
  /**
   * Streaming tool args JSON delta (was `emit({ type: 'tool-input-delta',
   * toolCallId, inputTextDelta })`).
   */
  onToolInputDelta(args: { toolCallId: string; inputTextDelta: string }): void;
  /**
   * Tool args fully parsed (was `emit({ type: 'tool-input-available',
   * toolCallId, toolName, input, providerExecuted: true })`).
   */
  onToolInputAvailable(args: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
  }): void;

  /**
   * Tool returned output (was `emit({ type: 'tool-output-available',
   * toolCallId, output, providerExecuted: true })`).
   */
  onToolOutputAvailable(args: {
    toolCallId: string;
    output: unknown;
    providerExecuted?: boolean;
  }): void;
  /**
   * Tool failed (was `emit({ type: 'tool-output-error', toolCallId,
   * errorText, providerExecuted: true })`).
   */
  onToolOutputError(args: {
    toolCallId: string;
    errorText: string;
    providerExecuted?: boolean;
  }): void;

  /** A turn-level error (was `emit({ type: 'error', errorText })`). */
  onError(args: { errorText: string }): void;
}
