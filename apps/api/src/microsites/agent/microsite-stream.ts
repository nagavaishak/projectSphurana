/**
 * The sidebar's stream (contract §4).
 *
 * The TRANSPORT is Claire's: SSE framing (`data: <json>\n\n`, `data: [DONE]`
 * to close) and the `TurnSink` seam, so the tool loop stays transport-agnostic
 * and there is one streaming mechanism in the codebase.
 *
 * The EVENT VOCABULARY is the contract's four events, which is deliberately
 * NOT Claire's `UIStreamEvent`. Claire's is the AI SDK's UI-message-stream
 * protocol — twenty chunk types, consumed by `useChat` — and the microsite
 * sidebar is a purpose-built panel that needs exactly four things: text,
 * an activity line per tool, the diff, and an error. Emitting the AI SDK
 * protocol here would mean the sidebar reassembling `tool-input-start` /
 * `tool-input-delta` / `tool-output-available` triplets just to draw one line
 * of activity, and re-deriving the diff client-side — the exact thing §4
 * forbids.
 *
 * So: same transport, different vocabulary. `MicrositeTurnSink` is the
 * translation, and it is the only place the two meet.
 */

import type { MicrositeTurnDiff } from '@borradh-workspace/features/microsites';
import type { Response } from 'express';
import type { TurnSink } from '../../assistant/lib/turn-sink.js';

/** Exactly the events the sidebar consumes (contract §4). */
export type MicrositeStreamEvent =
  | { type: 'text'; delta: string }
  | {
      type: 'tool';
      name: string;
      /** Human-readable: "Added a testimonials section". */
      summary: string;
      /**
       * The sidebar's flag: this tool call did NOT run and is waiting on the
       * user. Sent alongside `confirmation` so a client that only checks the
       * boolean still shows the right thing.
       */
      requiresConfirmation?: boolean;
      /**
       * Set when the tool refused pending explicit confirmation (contract §3).
       * The sidebar renders the confirm control and replays the turn with
       * `confirmedActions: [action]`. Additive to the §4 shape: without it the
       * sidebar cannot act on a confirmation at all.
       */
      confirmation?: { action: string; prompt: string };
    }
  | {
      type: 'done';
      /** Null when the turn changed nothing. */
      revisionId: string | null;
      diff: MicrositeTurnDiff;
      conversationId: string;
    }
  | { type: 'error'; message: string };

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

export function writeMicrositeStreamHeaders(res: Response): void {
  res.writeHead(200, SSE_HEADERS);
  const flushable = res as Response & { flushHeaders?: () => void };
  if (typeof flushable.flushHeaders === 'function') flushable.flushHeaders();
}

/** Idempotent on a disconnected client — see Claire's `emitUIStreamEvent`. */
export function emitMicrositeStreamEvent(
  res: Response,
  event: MicrositeStreamEvent
): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    // Client went away mid-stream; later writes no-op too.
  }
}

export function closeMicrositeStream(res: Response): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write('data: [DONE]\n\n');
    res.end();
  } catch {
    // See above.
  }
}

/**
 * Claire's engine events → the sidebar's four.
 *
 * Text deltas pass through. Tool activity is emitted ONCE per call, on the
 * OUTPUT (not the input), because the summary the sidebar shows is written by
 * the tool from what it actually did — "Added a testimonials section" is only
 * knowable after the fact, and a line drawn from the model's proposed
 * arguments would claim edits that then failed.
 */
export class MicrositeTurnSink implements TurnSink {
  private readonly names = new Map<string, string>();

  constructor(
    private readonly emit: (event: MicrositeStreamEvent) => void,
    /** Records what each tool call did, for the transcript. */
    private readonly onToolResult: (result: {
      toolCallId: string;
      toolName: string;
      input: unknown;
      output?: unknown;
      errorText?: string;
    }) => void
  ) {}

  onStepStart(): void {}
  onStepFinish(): void {}
  onTextStart(): void {}

  onTextDelta(args: { delta: string }): void {
    this.emit({ type: 'text', delta: args.delta });
  }

  onTextEnd(): void {}
  onReasoningStart(): void {}
  onReasoningDelta(): void {}
  onReasoningEnd(): void {}

  onToolInputStart(args: { toolCallId: string; toolName: string }): void {
    this.names.set(args.toolCallId, args.toolName);
  }

  onToolInputDelta(): void {}

  onToolInputAvailable(args: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }): void {
    this.names.set(args.toolCallId, args.toolName);
    this.inputs.set(args.toolCallId, args.input);
  }

  private readonly inputs = new Map<string, unknown>();

  onToolOutputAvailable(args: { toolCallId: string; output: unknown }): void {
    const name = this.names.get(args.toolCallId) ?? 'tool';
    const output = args.output as
      | {
          summary?: string;
          confirmationRequired?: { action: string; prompt: string };
        }
      | undefined;

    this.emit({
      type: 'tool',
      name,
      summary: output?.summary ?? name.replaceAll('_', ' '),
      ...(output?.confirmationRequired
        ? {
            requiresConfirmation: true,
            confirmation: output.confirmationRequired,
          }
        : {}),
    });

    this.onToolResult({
      toolCallId: args.toolCallId,
      toolName: name,
      input: this.inputs.get(args.toolCallId),
      output: args.output,
    });
  }

  onToolOutputError(args: { toolCallId: string; errorText: string }): void {
    const name = this.names.get(args.toolCallId) ?? 'tool';
    this.emit({
      type: 'tool',
      name,
      summary: `${name.replaceAll('_', ' ')} could not be completed: ${args.errorText}`,
    });
    this.onToolResult({
      toolCallId: args.toolCallId,
      toolName: name,
      input: this.inputs.get(args.toolCallId),
      errorText: args.errorText,
    });
  }

  onError(args: { errorText: string }): void {
    this.emit({ type: 'error', message: args.errorText });
  }
}
