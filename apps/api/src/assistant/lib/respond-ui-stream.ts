import type { Response } from 'express';
import {
  type UIStreamEvent,
  closeUIStream,
  emitUIStreamEvent,
  writeUIStreamHeaders,
} from './emit-ui-stream-event.js';

/**
 * Transport shim for the AI SDK UI message stream.
 *
 * The use case decides *what* goes on the wire (reject with a status + JSON
 * body, or open a stream and emit a sequence of already-decided events). This
 * file is the only place that touches the `Response` object: it writes the SSE
 * headers, encodes each event as a `data:` frame, and writes the `[DONE]`
 * terminator. Nothing here knows anything about Claire.
 *
 * `close` is handed to the use case rather than called for it, because the
 * chat turn deliberately terminates the stream BEFORE it persists messages —
 * the client must not wait on those writes. Calling `close()` here after
 * `run()` resolved would silently move the terminator after persistence.
 */

/** A rejection that happens before any stream frame is written. */
export interface UIStreamRejection {
  kind: 'reject';
  status: number;
  body: unknown;
}

/** Writers handed to the use case for the duration of the stream. */
export interface UIStreamWriter {
  emit: (event: UIStreamEvent) => void;
  /** Write `data: [DONE]` and end the response. */
  close: () => void;
}

/** An accepted turn: open the stream, then let the use case drive it. */
export interface UIStreamRun {
  kind: 'stream';
  /** Extra response headers merged over `UI_MESSAGE_STREAM_HEADERS`. */
  headers?: Record<string, string>;
  run: (writer: UIStreamWriter) => Promise<void>;
}

export type UIStreamPlan = UIStreamRejection | UIStreamRun;

/** Execute a stream plan against an Express response. */
export async function respondWithUIStream(
  res: Response,
  plan: UIStreamPlan
): Promise<void> {
  if (plan.kind === 'reject') {
    res.status(plan.status).json(plan.body);
    return;
  }

  writeUIStreamHeaders(res, plan.headers ?? {});
  await plan.run({
    emit: (event) => emitUIStreamEvent(res, event),
    close: () => closeUIStream(res),
  });
}
