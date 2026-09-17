import type { JobsOptions } from 'bullmq';
import type { z } from 'zod';

/**
 * The job spine: ONE declaration per queue, ONE declaration per job payload.
 *
 * Why this exists (the bug it closes):
 *
 *   The `video-render` payload used to be declared THREE times — once in
 *   `queue-video-export.service.ts` (11 fields), once in
 *   `retry-failed-job.service.ts` (7 fields — no `theme`, no
 *   `synthesisOverrides`) and once in `apps/video-worker/src/main.ts`
 *   (9 fields). Retrying a failed branded render therefore SUCCEEDED and
 *   produced a video with the wrong theme and none of the frozen content,
 *   while the main producer's own comment said `theme` was carried "so retries
 *   replay deterministically". Nothing failed. Nothing logged.
 *
 *   Separately, the retry path built its OWN `Queue('video-render')` instance
 *   with `attempts: 1` against the producer's documented `attempts: 3`. BullMQ
 *   applies `defaultJobOptions` per *instance* at `.add()` time, so a
 *   manually-retried render silently got one shot.
 *
 * The rules this file encodes:
 *
 *   1. Job options belong to the QUEUE, not to a call site. There is exactly
 *      one `Queue` instance per queue name (see `job-queue.ts`), built from the
 *      queue declaration — so two producers cannot disagree about `attempts`.
 *   2. A payload is declared ONCE, as a zod schema. Producers take
 *      `z.input<schema>` and workers take `z.output<schema>` and PARSE.
 *   3. Optional-in-spirit fields are declared **required-and-nullable**, not
 *      optional. That is the whole point: a producer that forgets `theme` then
 *      fails to COMPILE instead of silently shipping an unthemed render.
 */

/** A BullMQ queue, declared once. */
export interface QueueDefinition {
  /** The Redis queue name. The single source of this string. */
  readonly name: string;
  /**
   * `defaultJobOptions` for the ONE `Queue` instance we build for this name.
   * Declared here so a second producer cannot invent a different retry policy.
   */
  readonly jobOptions?: JobsOptions;
  /**
   * True when terminal failures are copied to `<name>-dlq` (either via
   * `shared/queue/dead-letter.ts` or a bespoke DLQ producer). Drives the
   * derived DLQ list that metrics and Bull Board watch.
   */
  readonly deadLetter?: boolean;
  /**
   * A queue that is declared but has NO worker, on purpose. The string is the
   * reason and is read in review — an explicit disabled declaration is fine, a
   * silent orphan is not. The registry gate fails on any non-disabled queue
   * with no worker, and on any `disabled` queue that DOES have one.
   */
  readonly disabled?: string;
  /** One-line description of what the queue does (for Bull Board / docs). */
  readonly description: string;
}

export const defineQueue = (def: QueueDefinition): QueueDefinition => def;

/** A single job name on a queue, with its one payload declaration. */
export interface JobDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly queue: QueueDefinition;
  /** BullMQ job name — what workers switch on. */
  readonly name: string;
  /** The ONE payload declaration. Producers `z.input`, workers `z.output`. */
  readonly payload: S;
  /**
   * Defaults merged UNDER raw job data before the worker parses it.
   *
   * This exists for exactly one reason: jobs already sitting in Redis when a
   * new required field ships. Producers cannot omit a field (that is a compile
   * error), so these defaults only ever apply to in-flight jobs enqueued by an
   * older deploy. Without them the worker would hard-fail every queued job on
   * the deploy that adds a field.
   */
  readonly legacyDefaults?: Partial<z.input<S>>;
}

export const defineJob = <S extends z.ZodTypeAny>(
  def: JobDefinition<S>
): JobDefinition<S> => def;

/** What a producer must supply. */
export type JobInput<D extends JobDefinition> = z.input<D['payload']>;

/** What a worker sees after `parseJobData`. */
export type JobOutput<D extends JobDefinition> = z.output<D['payload']>;

/**
 * Exhaustiveness helper for workers that route by `job.name`. A `default:`
 * branch that logs-and-completes turns "I added a job name and forgot the
 * handler" into a job that reports SUCCESS having done nothing. Call this in
 * the default branch with the narrowed value so the omission is a compile
 * error instead.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(
    `${context}: unhandled variant ${JSON.stringify(value)} — every job name on the queue must have a handler`
  );
}
