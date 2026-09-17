import { z } from 'zod';

/**
 * BullMQ queue name for backgrounded Meta data syncs. Must match the consumer
 * constant in `apps/video-worker/src/meta-sync-processor.ts`.
 */
export const META_SYNC_QUEUE = 'meta-sync';

export const queueMetaSyncSchema = z.object({
  organizationId: z.string().min(1),
  /**
   * Acting user. REQUIRED, though the sync itself only carries it for
   * observability: `syncMetaData` validates `userId` as non-empty, so a job
   * queued without one can do nothing but fail validation on the worker —
   * asynchronously, where nobody is watching. The only caller (POST
   * meta-campaigns/sync-all) always has an authenticated user, so requiring it
   * costs nothing and makes the unrunnable job unrepresentable.
   */
  userId: z.string().min(1),
  /** Bypass the 5-minute server-side throttle inside syncMetaData. */
  force: z.boolean().optional().default(false),
});

export type QueueMetaSyncInput = z.infer<typeof queueMetaSyncSchema>;

/** Payload carried on the BullMQ job. */
export type MetaSyncJobPayload = QueueMetaSyncInput;
