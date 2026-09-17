import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { attemptFixture, slotFixture } from '../_shared/test-fixtures.js';
import { discardItemVideoEdits } from './discard-item-video-edits.service.js';

const ITEM_ID = 'item-1';
const ORG_ID = 'org-1';

const staged = {
  clipOperations: [{ op: 'replace-all', assetIds: ['a', 'b'] }],
  patch: { mythFact: { pairs: [] } },
};

function createMockDb(
  options: { pendingVideoEdits?: unknown; pendingRegenerate?: unknown } = {}
) {
  const { pendingVideoEdits = staged, pendingRegenerate = null } = options;

  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.innerJoin = vi.fn(self);
  chain.limit = vi.fn(() =>
    Promise.resolve([
      {
        slot: slotFixture({ id: ITEM_ID, kind: 'video', pendingRegenerate }),
        attempt: attemptFixture({
          id: 'attempt-1',
          slotId: ITEM_ID,
          videoId: 'video-1',
          pendingVideoEdits,
        }),
      },
    ])
  );
  const updates: Record<string, unknown>[] = [];
  chain.update = vi.fn(self);
  chain.set = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    return chain;
  });
  chain.where = vi.fn(() => {
    const promise = Promise.resolve([]) as unknown as Record<string, unknown>;
    promise.limit = chain.limit;
    return promise;
  });

  return { db: chain, updates };
}

describe('discardItemVideoEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Rejecting has to leave NOTHING behind, or the next Accept commits a change
  // the owner explicitly declined.
  it('clears the clip operations and the text patch together', async () => {
    const { db } = createMockDb();

    const result = await discardItemVideoEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discarded).toBe(true);
    expect((db.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      pendingVideoEdits: null,
    });
  });

  // A second press, or a press after another tab applied the edits, should
  // report calmly rather than fail at someone who did nothing wrong.
  it('reports a no-op when nothing is staged', async () => {
    const { db } = createMockDb({ pendingVideoEdits: null });

    const result = await discardItemVideoEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discarded).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('validates its input', async () => {
    const { db } = createMockDb();

    const result = await discardItemVideoEdits(db as never, {
      itemId: '',
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});

describe('discardItemVideoEdits — a proposed re-roll', () => {
  beforeEach(() => vi.clearAllMocks());

  // Nothing cleared `pendingRegenerate` except spending it, so a declined
  // re-roll came back on the next load still offering to spend a render the
  // owner had already said no to.
  it('clears a proposal the owner declined', async () => {
    const { db, updates } = createMockDb({
      pendingVideoEdits: null,
      pendingRegenerate: [{ slideIndex: 5, op: 'refine', note: 'different' }],
    });

    const result = await discardItemVideoEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discarded).toBe(true);
    expect(updates).toContainEqual(
      expect.objectContaining({ pendingRegenerate: null })
    );
  });

  // Rejecting is one decision about everything staged — leaving half behind
  // would honour a button the owner never saw.
  it('clears staged edits and a proposal together', async () => {
    const { db, updates } = createMockDb({
      pendingRegenerate: [{ slideIndex: null, op: 'refine', note: 'warmer' }],
    });

    await discardItemVideoEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(updates).toContainEqual(
      expect.objectContaining({ pendingVideoEdits: null })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({ pendingRegenerate: null })
    );
  });

  it('reports calmly when there is nothing staged at all', async () => {
    const { db } = createMockDb({
      pendingVideoEdits: null,
      pendingRegenerate: null,
    });

    const result = await discardItemVideoEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discarded).toBe(false);
  });
});
