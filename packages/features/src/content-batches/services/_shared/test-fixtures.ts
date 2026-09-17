import type { ContentAttempt, ContentItem } from '@borradh-workspace/database';
import { vi } from '@borradh-workspace/testing';

/**
 * Fixtures for the row shape `loadSlotForOrg` returns.
 *
 * Five test files built the joined row by hand as `{ item, batchOrgId }`. When
 * the join gained the attempt, all five broke in the same way — so the shape
 * is described once here, next to the loader that produces it.
 */
export const slotFixture = (
  overrides: Partial<ContentItem> = {}
): ContentItem =>
  ({
    id: 'item_123',
    batchId: 'batch_123',
    kind: 'video',
    currentAttemptId: 'attempt_123',
    reviewStatus: 'pending',
    position: 0,
    regenerationCount: 0,
    scheduledSocialPostId: null,
    scheduledAt: null,
    targetPageIds: null,
    videoIdea: null,
    pendingRegenerate: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as ContentItem;

export const attemptFixture = (
  overrides: Partial<ContentAttempt> = {}
): ContentAttempt =>
  ({
    id: 'attempt_123',
    slotId: 'item_123',
    batchId: 'batch_123',
    attemptNumber: 0,
    videoId: 'video_123',
    graphicId: null,
    caption: 'Original caption from the planner.',
    pendingVideoEdits: null,
    editRenderCount: 0,
    regenerationReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as ContentAttempt;

/** The joined row shape `loadSlotForOrg`'s select produces. */
/**
 * A row as `loadSlotForOrg` now returns it.
 *
 * `batchOrgId` is gone: ownership used to be proved by joining through
 * `content_batch` and comparing the org in application code, so the fixture had
 * to carry it. It is a `WHERE` predicate on `content_item.organization_id` now,
 * which means a foreign org produces NO ROW rather than a row that fails a
 * later check — so the cross-org cases pass an empty result instead.
 */
export const joinedRow = (args: {
  slot?: Partial<ContentItem>;
  attempt?: Partial<ContentAttempt>;
}) => ({
  slot: slotFixture(args.slot),
  attempt: attemptFixture(args.attempt),
});

/**
 * The batch row the status settle reads back, in a state where settling is a
 * no-op: one slot still rendering, so 'generating' recomputes to 'generating'
 * and nothing is written.
 *
 * Accepting, rejecting, regenerating and undoing an item all settle the batch
 * afterwards. Their tests are about the ITEM, so they hand the settle a batch
 * that needs no transition and keep asserting on `update`/`insert` without a
 * settle write landing in the middle. The transitions themselves are asserted
 * directly against `settleBatchStatus`.
 */
export const settleNoopBatch = {
  id: 'batch_123',
  status: 'generating',
  items: [
    {
      id: 'item_123',
      kind: 'video',
      reviewStatus: 'pending',
      currentAttempt: {
        id: 'attempt_123',
        video: { status: 'rendering' },
        graphic: null,
      },
    },
  ],
};

/** `settleNoopBatch` wired as the `query` half of a hand-rolled db mock. */
export const settleNoopQuery = () => ({
  contentBatch: { findFirst: vi.fn().mockResolvedValue(settleNoopBatch) },
});
