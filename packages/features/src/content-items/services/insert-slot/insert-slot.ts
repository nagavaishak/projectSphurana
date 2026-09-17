import { randomUUID } from 'node:crypto';
import {
  type ContentItemSource,
  type VideoIdea,
  contentAttempt,
  contentItem,
} from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

export interface InsertSlotInput {
  organizationId: string;
  /**
   * The monthly plan this slot belongs to, or `null` for a standalone item
   * (Claire chat, Content Studio). `position` follows it: it only means
   * something relative to the other posts in a plan.
   */
  batchId: string | null;
  source: ContentItemSource;
  kind: 'video' | 'graphic';
  position: number | null;
  /** Exactly one of these, matching `kind`. */
  videoId?: string | null;
  graphicId?: string | null;
  caption?: string | null;
  scheduledAt?: Date | null;
  targetPageIds?: string[] | null;
  videoIdea?: VideoIdea | null;
}

/**
 * Create a post: the slot, its first cut, and the pointer between them.
 *
 * Always all three, always in one transaction. A slot with no attempt reads as
 * an empty post everywhere — `getBatch` skips it, `loadSlotForOrg` reports it
 * missing — so the window where it exists alone must not be observable, and
 * must not survive a crash. Every caller that seeds content goes through here
 * rather than assembling the three writes itself.
 *
 * Returns both ids because callers need the slot id for their own bookkeeping
 * and, occasionally, the attempt id for provenance.
 */
export const insertSlotWithFirstAttempt = async (
  db: DbConnection,
  input: InsertSlotInput
): Promise<{ slotId: string; attemptId: string }> => {
  const slotId = randomUUID();
  const attemptId = randomUUID();

  await db.transaction(async (trx) => {
    await trx.insert(contentItem).values({
      id: slotId,
      organizationId: input.organizationId,
      batchId: input.batchId,
      source: input.source,
      kind: input.kind,
      position: input.position,
      reviewStatus: 'pending',
      scheduledAt: input.scheduledAt ?? null,
      targetPageIds: input.targetPageIds ?? null,
      videoIdea: input.videoIdea ?? null,
    });

    await trx.insert(contentAttempt).values({
      id: attemptId,
      organizationId: input.organizationId,
      slotId,
      batchId: input.batchId,
      attemptNumber: 0,
      videoId: input.videoId ?? null,
      graphicId: input.graphicId ?? null,
      caption: input.caption ?? null,
    });

    await trx
      .update(contentItem)
      .set({ currentAttemptId: attemptId })
      .where(eq(contentItem.id, slotId));
  });

  return { slotId, attemptId };
};
