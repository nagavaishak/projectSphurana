/**
 * Canonical mock for `bullmq`.
 *
 * Aliased in vite.config.ts so the real BullMQ `Queue` (which would open a
 * non-functional Redis connection in tests and hang on `queue.add(...)`) is
 * never constructed. Every test file sees the *same* mock — a prerequisite for
 * `isolate: false`.
 *
 * Test files should NOT `vi.mock('bullmq', ...)`. Instead import the canonical
 * instance objects exported here (`mockQueue`, `mockJob`) and drive them with
 * `mockResolvedValue` / assert on them directly. `beforeEach(vi.clearAllMocks())`
 * resets call history between tests.
 *
 * The `Queue` constructor always returns the SAME `mockQueue` object, so it is
 * safe under a shared module registry — there is no per-file
 * `Queue.mockImplementation(...)` state to leak.
 */
import { vi } from 'vitest';

/**
 * Stable shared object returned by every `new Queue(...)`. Covers every method
 * the features services call on a `Queue` instance.
 */
export const mockQueue = {
  add: vi.fn(),
  close: vi.fn(),
  getJob: vi.fn(),
  getJobs: vi.fn(),
  getWaiting: vi.fn(),
  getActive: vi.fn(),
  getCompleted: vi.fn(),
  getFailed: vi.fn(),
  getDelayed: vi.fn(),
  getWaitingCount: vi.fn(),
  getActiveCount: vi.fn(),
  getCompletedCount: vi.fn(),
  getFailedCount: vi.fn(),
  getDelayedCount: vi.fn(),
  getJobCounts: vi.fn(),
  isPaused: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  remove: vi.fn(),
  drain: vi.fn(),
  obliterate: vi.fn(),
};

/** Stable shared object returned by every `new Worker(...)`. */
export const mockWorker = {
  close: vi.fn(),
  on: vi.fn(),
  run: vi.fn(),
};

/** Stable shared object returned by every `new QueueEvents(...)`. */
export const mockQueueEvents = {
  close: vi.fn(),
  on: vi.fn(),
};

/** Stable shared object returned by every `new FlowProducer(...)`. */
export const mockFlowProducer = {
  add: vi.fn(),
  close: vi.fn(),
};

export const Queue = vi.fn(() => mockQueue);
export const Worker = vi.fn(() => mockWorker);
export const QueueEvents = vi.fn(() => mockQueueEvents);
export const FlowProducer = vi.fn(() => mockFlowProducer);
