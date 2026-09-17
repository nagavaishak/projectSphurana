import type { ToolResult } from './types.js';

/**
 * Factory-level circuit breaker (Phase 4).
 *
 * The corpus is full of the same tool being called with the same arguments and
 * failing the same way three, four, five times in a row (#9, #37) — the model
 * has no memory that the last identical attempt already failed, so it just
 * tries again until it burns the turn's tool budget. Nothing stopped it.
 *
 * This tracker gives the factory a per-turn memory: it counts identical
 * failures of a single tool and, once a tool has failed identically
 * `threshold` times, trips — the factory converts the next such failure into a
 * `stop_and_ask` result telling the model to stop retrying and ask the user how
 * to proceed. It is created once per chat request and shared across every tool
 * call in the turn, exactly like the tool-call counter.
 */
export interface ToolFailureTracker {
  /** signature → number of identical failures seen this turn. */
  counts: Map<string, number>;
  /** Trip once a signature reaches this many failures. Default 2. */
  threshold: number;
}

/** Default: trip after two identical failures of one tool in a turn. */
export const DEFAULT_FAILURE_THRESHOLD = 2;

export function createToolFailureTracker(
  threshold: number = DEFAULT_FAILURE_THRESHOLD
): ToolFailureTracker {
  return { counts: new Map(), threshold };
}

/**
 * Signature identifying "the same failure". A failure is the same when the
 * same tool fails with the same code and the same sanitized message — that is
 * what "identical failure" means to the operator watching Claire spin.
 *
 * Input is deliberately NOT part of the signature: the audit's loops re-issue
 * the same call, but even a slightly varied retry that keeps hitting the same
 * error (e.g. the same auth/validation wall) is exactly what we want to stop.
 */
export function toolFailureSignature(
  toolName: string,
  result: Extract<ToolResult, { ok: false }>
): string {
  return `${toolName}::${result.code ?? 'NO_CODE'}::${result.error}`;
}

export interface FailureTrackerOutcome {
  tripped: boolean;
  count: number;
}

/**
 * Record a failed tool result and report whether the breaker has tripped.
 * `tripped` is true once this signature has now failed `threshold`+ times.
 */
export function recordToolFailure(
  tracker: ToolFailureTracker,
  toolName: string,
  result: Extract<ToolResult, { ok: false }>
): FailureTrackerOutcome {
  const signature = toolFailureSignature(toolName, result);
  const count = (tracker.counts.get(signature) ?? 0) + 1;
  tracker.counts.set(signature, count);
  return { tripped: count >= tracker.threshold, count };
}

/**
 * The tool-emitted presentation the frontend renders when the breaker trips.
 * `stop_and_ask` is a distinct card so the operator sees "Claire stopped
 * retrying" rather than the same red error a third time.
 */
export interface StopAndAskPresentation {
  type: 'stop_and_ask';
  toolName: string;
  failureCount: number;
  /** The underlying failure the tool kept hitting. */
  reason: string;
  // Index signature so this satisfies the factory's open `PresentationPayload`
  // variant (`Record<string, unknown> & { type: string }`).
  [key: string]: unknown;
}

/**
 * Fold the tripped breaker into the failing result: attach the `stop_and_ask`
 * presentation and rewrite the error so the model is told, in-band, to stop
 * retrying and ask the user. Keeps the original `code` for telemetry.
 */
export function applyStopAndAsk(
  toolName: string,
  result: Extract<ToolResult, { ok: false }>,
  count: number
): Extract<ToolResult, { ok: false }> {
  const presentation: StopAndAskPresentation = {
    type: 'stop_and_ask',
    toolName,
    failureCount: count,
    reason: result.error,
  };
  return {
    ok: false,
    code: result.code ?? 'CIRCUIT_BREAKER_TRIPPED',
    error: `This action has now failed ${count} times in a row with the same error: ${result.error} Do NOT try it again this turn — stop and ask the user how they would like to proceed, or explain what is blocking it.`,
    presentation,
  };
}
