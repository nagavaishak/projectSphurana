import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type Job, type JobsOptions, Queue } from 'bullmq';
import type { z } from 'zod';
import type {
  JobDefinition,
  JobInput,
  JobOutput,
  QueueDefinition,
} from './define-job.js';

/**
 * ONE `Queue` instance per queue name, for the whole process.
 *
 * BullMQ applies `defaultJobOptions` per *instance* at `.add()` time. When two
 * modules each `new Queue('video-render', …)` with different options, the retry
 * policy a job gets depends on which module enqueued it — which is exactly how
 * a manually-retried render ended up with `attempts: 1` against a documented
 * `attempts: 3`. Routing every producer through this cache makes that
 * impossible: the options come from the queue declaration.
 */
const instances = new Map<string, Queue>();

export function getJobQueue(def: QueueDefinition): Queue {
  let queue = instances.get(def.name);
  if (!queue) {
    queue = new Queue(def.name, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: def.jobOptions,
    });
    instances.set(def.name, queue);
  }
  return queue;
}

/** Close one queue (graceful shutdown). */
export async function closeJobQueue(def: QueueDefinition): Promise<void> {
  const queue = instances.get(def.name);
  if (!queue) return;
  instances.delete(def.name);
  await queue.close();
}

/** Close every queue this process opened (graceful shutdown / tests). */
export async function closeJobQueues(): Promise<void> {
  const open = [...instances.values()];
  instances.clear();
  await Promise.all(open.map((q) => q.close()));
}

/**
 * Enqueue a job. The payload is validated against the ONE declaration, so a
 * producer cannot ship a shape the worker can't read — and, because the schema
 * declares replay-critical fields as required-and-nullable, a producer that
 * *forgets* one does not compile.
 */
export async function enqueueJob<S extends z.ZodTypeAny>(
  def: JobDefinition<S>,
  data: JobInput<JobDefinition<S>>,
  options?: JobsOptions
): Promise<Job<JobOutput<JobDefinition<S>>>> {
  if (def.queue.disabled) {
    throw new Error(
      `Queue "${def.queue.name}" is declared disabled and has no worker — a job enqueued here would never run. Reason: ${def.queue.disabled}`
    );
  }
  const parsed = def.payload.parse(data) as JobOutput<JobDefinition<S>>;
  const queue = getJobQueue(def.queue);
  return (await queue.add(def.name, parsed, options)) as Job<
    JobOutput<JobDefinition<S>>
  >;
}

/**
 * Parse raw job data on the worker side.
 *
 * `legacyDefaults` are merged UNDER the raw data so jobs enqueued by an older
 * deploy (before a field existed) still parse. Producers cannot rely on them —
 * they are compile-checked against the full schema.
 */
export function parseJobData<S extends z.ZodTypeAny>(
  def: JobDefinition<S>,
  raw: unknown
): JobOutput<JobDefinition<S>> {
  const merged =
    raw && typeof raw === 'object'
      ? { ...(def.legacyDefaults ?? {}), ...(raw as Record<string, unknown>) }
      : raw;
  return def.payload.parse(merged) as JobOutput<JobDefinition<S>>;
}
