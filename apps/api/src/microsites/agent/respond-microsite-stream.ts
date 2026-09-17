/**
 * The only file that touches the `Response` for a microsite turn.
 *
 * Mirrors `assistant/lib/respond-ui-stream.ts`: the use case returns a plan of
 * already-decided events, and `close` is handed to it rather than called for
 * it, because the turn deliberately terminates the stream AFTER it has written
 * the `done` event and persisted the turn — the diff is the point of the
 * stream, so it cannot be raced by the terminator.
 */

import type { Response } from 'express';
import {
  closeMicrositeStream,
  emitMicrositeStreamEvent,
  writeMicrositeStreamHeaders,
} from './microsite-stream.js';
import type { MicrositeChatPlan } from './run-microsite-chat-turn.js';

export async function respondWithMicrositeStream(
  res: Response,
  plan: MicrositeChatPlan
): Promise<void> {
  if (plan.kind === 'reject') {
    res.status(plan.status).json(plan.body);
    return;
  }

  writeMicrositeStreamHeaders(res);
  await plan.run({
    emit: (event) => emitMicrositeStreamEvent(res, event),
    close: () => closeMicrositeStream(res),
  });
}
