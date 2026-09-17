import type { UIStreamEvent } from './emit-ui-stream-event.js';
import type { TurnSink } from './turn-sink.js';

/**
 * `SseSink` — the web transport for the Claire tool loop.
 *
 * Each method maps 1:1 to the `emit({ type: 'x', ... })` call the loop made
 * before the `TurnSink` extraction, so the SSE wire output is byte-identical
 * pre/post refactor. Constructed with the controller's `emit` writer (which
 * forwards to `emitUIStreamEvent(res, ...)`).
 */
export class SseSink implements TurnSink {
  constructor(private readonly emit: (event: UIStreamEvent) => void) {}

  onStepStart(): void {
    this.emit({ type: 'start-step' });
  }

  onStepFinish(): void {
    this.emit({ type: 'finish-step' });
  }

  onTextStart(args: { id: string }): void {
    this.emit({ type: 'text-start', id: args.id });
  }

  onTextDelta(args: { id: string; delta: string }): void {
    this.emit({ type: 'text-delta', id: args.id, delta: args.delta });
  }

  onTextEnd(args: { id: string }): void {
    this.emit({ type: 'text-end', id: args.id });
  }

  onReasoningStart(args: { id: string }): void {
    this.emit({ type: 'reasoning-start', id: args.id });
  }

  onReasoningDelta(args: { id: string; delta: string }): void {
    this.emit({ type: 'reasoning-delta', id: args.id, delta: args.delta });
  }

  onReasoningEnd(args: { id: string }): void {
    this.emit({ type: 'reasoning-end', id: args.id });
  }

  onToolInputStart(args: {
    toolCallId: string;
    toolName: string;
    providerExecuted?: boolean;
  }): void {
    this.emit({
      type: 'tool-input-start',
      toolCallId: args.toolCallId,
      toolName: args.toolName,
      providerExecuted: args.providerExecuted,
    });
  }

  onToolInputDelta(args: { toolCallId: string; inputTextDelta: string }): void {
    this.emit({
      type: 'tool-input-delta',
      toolCallId: args.toolCallId,
      inputTextDelta: args.inputTextDelta,
    });
  }

  onToolInputAvailable(args: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
  }): void {
    this.emit({
      type: 'tool-input-available',
      toolCallId: args.toolCallId,
      toolName: args.toolName,
      input: args.input,
      providerExecuted: args.providerExecuted,
    });
  }

  onToolOutputAvailable(args: {
    toolCallId: string;
    output: unknown;
    providerExecuted?: boolean;
  }): void {
    this.emit({
      type: 'tool-output-available',
      toolCallId: args.toolCallId,
      output: args.output,
      providerExecuted: args.providerExecuted,
    });
  }

  onToolOutputError(args: {
    toolCallId: string;
    errorText: string;
    providerExecuted?: boolean;
  }): void {
    this.emit({
      type: 'tool-output-error',
      toolCallId: args.toolCallId,
      errorText: args.errorText,
      providerExecuted: args.providerExecuted,
    });
  }

  onError(args: { errorText: string }): void {
    this.emit({ type: 'error', errorText: args.errorText });
  }
}
