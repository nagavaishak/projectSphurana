import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { attemptFixture, slotFixture } from '../_shared/test-fixtures.js';
import { stageItemClipEdits } from './stage-item-clip-edits.service.js';

const ITEM_ID = 'item-1';
const ORG_ID = 'org-1';

function createMockDb(options: { itemRows?: unknown[] } = {}) {
  const {
    itemRows = [
      {
        slot: slotFixture({ id: ITEM_ID, batchId: 'batch-1', kind: 'video' }),
        attempt: attemptFixture({
          id: 'attempt-1',
          slotId: ITEM_ID,
          batchId: 'batch-1',
          videoId: 'video-1',
        }),
      },
    ],
  } = options;

  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.innerJoin = vi.fn(self);
  chain.limit = vi.fn(() => Promise.resolve(itemRows));
  chain.update = vi.fn(self);
  chain.set = vi.fn(self);
  // `where` closes the update chain (no `.returning()`), so it has to resolve.
  chain.where = vi.fn(() => {
    const promise = Promise.resolve([]) as unknown as Record<string, unknown>;
    promise.limit = chain.limit;
    return promise;
  });

  return chain;
}

/** What the service wrote to `pendingVideoEdits`. */
function stagedEdits(db: Record<string, unknown>) {
  const set = db.set as ReturnType<typeof vi.fn>;
  return (
    set.mock.calls[0]?.[0] as {
      pendingVideoEdits?: {
        clipOperations?: { op: string; assetIds?: string[] }[];
        patch?: Record<string, unknown>;
      };
    }
  ).pendingVideoEdits;
}

describe('stageItemClipEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stages the whole list as one replace-all operation', async () => {
    const db = createMockDb();

    const result = await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['c', 'a', 'b'],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clipCount).toBe(3);
    expect(stagedEdits(db)?.clipOperations).toEqual([
      { op: 'replace-all', assetIds: ['c', 'a', 'b'] },
    ]);
  });

  // Nothing renders here. Four of the five earlier attempts at this feature
  // rendered on save, and one announced a render the server had declined to
  // start — the owner decides when a render is spent.
  it('does not render — it only writes the staged list', async () => {
    const db = createMockDb();

    await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['a'],
    });

    const set = db.set as ReturnType<typeof vi.fn>;
    expect(Object.keys(set.mock.calls[0]?.[0] as object)).toEqual([
      'pendingVideoEdits',
    ]);
  });

  // The list is absolute — the owner's latest word on the WHOLE list, not
  // another instruction to fold in. A stacked `swap` would address positions
  // that no longer mean what they meant when it was staged.
  it('replaces previously staged clip operations rather than appending', async () => {
    const db = createMockDb({
      itemRows: [
        {
          slot: slotFixture({ id: ITEM_ID, kind: 'video' }),
          attempt: attemptFixture({
            id: 'attempt-1',
            slotId: ITEM_ID,
            videoId: 'video-1',
            pendingVideoEdits: {
              clipOperations: [{ op: 'swap', index: 1, assetId: 'old' }],
              patch: {},
            },
          }),
        },
      ],
    });

    await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['a', 'b'],
    });

    expect(stagedEdits(db)?.clipOperations).toEqual([
      { op: 'replace-all', assetIds: ['a', 'b'] },
    ]);
  });

  // The text patch was staged by a different surface and addresses a different
  // part of the draft. Dropping it here loses an edit the owner watched Claire
  // make.
  it('preserves a staged on-screen text patch', async () => {
    const db = createMockDb({
      itemRows: [
        {
          slot: slotFixture({ id: ITEM_ID, kind: 'video' }),
          attempt: attemptFixture({
            id: 'attempt-1',
            slotId: ITEM_ID,
            videoId: 'video-1',
            pendingVideoEdits: {
              clipOperations: [],
              patch: { mythFact: { pairs: [] } },
            },
          }),
        },
      ],
    });

    await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['a'],
    });

    expect(stagedEdits(db)?.patch).toEqual({ mythFact: { pairs: [] } });
  });

  it('refuses an empty list', async () => {
    const db = createMockDb();

    const result = await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses a graphic post', async () => {
    const db = createMockDb({
      itemRows: [
        {
          slot: slotFixture({ id: ITEM_ID, kind: 'graphic' }),
          attempt: attemptFixture({
            id: 'attempt-1',
            slotId: ITEM_ID,
            videoId: null,
            graphicId: 'graphic-1',
          }),
        },
      ],
    });

    const result = await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['a'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('refuses a post that has already been decided', async () => {
    const db = createMockDb({
      itemRows: [
        {
          slot: slotFixture({
            id: ITEM_ID,
            kind: 'video',
            reviewStatus: 'accepted',
          }),
          attempt: attemptFixture({
            id: 'attempt-1',
            slotId: ITEM_ID,
            videoId: 'video-1',
          }),
        },
      ],
    });

    const result = await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['a'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for another org’s item', async () => {
    const db = createMockDb({ itemRows: [] });

    const result = await stageItemClipEdits(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      assetIds: ['a'],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
