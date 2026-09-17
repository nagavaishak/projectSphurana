import type { Response } from 'express';

/**
 * AI SDK UI message stream protocol — the wire format the frontend
 * `useChat({ transport: DefaultChatTransport })` consumes.
 *
 * Each chunk is sent as one Server-Sent-Events frame: `data: <json>` followed
 * by a blank line. `data: [DONE]` (then a blank line) closes the stream. The
 * headers must include `x-vercel-ai-ui-message-stream: v1` so the client
 * identifies the format. See the `ai` package source for the JsonToSse
 * transform and the canonical header set (UI_MESSAGE_STREAM_HEADERS).
 */

/** Minimal set of UI message stream chunks the controller emits. */
export type UIStreamEvent =
  | { type: 'start'; messageId: string }
  | { type: 'start-step' }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | {
      type: 'tool-input-start';
      toolCallId: string;
      toolName: string;
      title?: string;
      /**
       * Mark this tool as server-executed so the AI SDK's
       * `lastAssistantMessageIsCompleteWithToolCalls` doesn't fire an
       * auto-send after the stream finishes. Without it, the SDK assumes
       * the tool needs client-side execution and re-POSTs the conversation
       * — that follow-up request was the source of "tool_use without
       * tool_result" Anthropic errors on every "second message".
       */
      providerExecuted?: boolean;
    }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | {
      type: 'tool-input-available';
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerExecuted?: boolean;
    }
  | {
      type: 'tool-output-available';
      toolCallId: string;
      output: unknown;
      providerExecuted?: boolean;
    }
  | {
      type: 'tool-output-error';
      toolCallId: string;
      errorText: string;
      providerExecuted?: boolean;
    }
  | { type: 'finish-step' }
  | {
      type: 'finish';
      finishReason?: 'stop' | 'tool-calls' | 'length' | 'error' | 'other';
    }
  | { type: 'error'; errorText: string }
  | { type: 'abort'; reason?: string };

/** SSE response headers the AI SDK client expects on the assistant chat route. */
export const UI_MESSAGE_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'x-accel-buffering': 'no',
} as const;

/** Write the SSE response headers + flush so the client opens the stream. */
export function writeUIStreamHeaders(
  res: Response,
  extra: Record<string, string> = {}
): void {
  res.writeHead(200, {
    ...UI_MESSAGE_STREAM_HEADERS,
    ...extra,
  });
  // Flush headers immediately so the browser knows to begin streaming —
  // without this the first frame would buffer until the first chunk lands,
  // which can be hundreds of ms on slow connections.
  if (
    typeof (res as Response & { flushHeaders?: () => void }).flushHeaders ===
    'function'
  ) {
    (res as Response & { flushHeaders: () => void }).flushHeaders();
  }
}

/**
 * Encode and write one UI message stream chunk as an SSE `data:` frame.
 *
 * Idempotent on closed responses — if the client has already disconnected
 * the underlying socket throws, which we swallow (one chunk's failure
 * shouldn't crash the controller mid-stream; the next `res.write` will
 * also no-op).
 */
export function emitUIStreamEvent(res: Response, event: UIStreamEvent): void {
  if (res.writableEnded || res.destroyed) return;
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  try {
    res.write(frame);
  } catch {
    // Client disconnected mid-stream. Future writes will also fail; we don't
    // log here because the controller's outer error handler will pick it up.
  }
}

/**
 * Close the SSE stream cleanly. The AI SDK client treats `data: [DONE]\n\n`
 * as the terminator (separately from the `finish` chunk above, which is the
 * UI-level "model finished" signal).
 */
export function closeUIStream(res: Response): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write('data: [DONE]\n\n');
    res.end();
  } catch {
    // See emitUIStreamEvent — disconnected client is the typical path here.
  }
}
