import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// ── Stub the two downstream services the regen fans out to ───────────────
// Spy the SOURCE modules, not their barrels: barrel re-exports are live getters
// under Vite SSR and cannot be redefined, and a file-local `vi.mock` would
// persist on the shared worker module graph under `isolate: false`.
import * as regenerateGraphicModule from '../../../graphics/services/regenerate-graphic/regenerate-graphic.service.js';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import * as planVideoDetailModule from '../../../videos/services/plan-video-detail/plan-video-detail.service.js';

import { regenerateBatchItem } from './regenerate-batch-item.service.js';

const hoisted = {
  mockPlanVideoDetail: undefined as unknown as MockInstance,
  mockRegenerateGraphic: undefined as unknown as MockInstance,
};

// ── Chain builders (mirrors reject-batch-item.test.ts) ───────────────────
//
// Two shapes share one chain because `mockDb.select` hands back the same
// object to every caller:
//   - `.limit(n)` terminates the joined slot+attempt load, and the
//     periodMonth lookup;
//   - awaiting the chain directly terminates the attempt COUNT, which has no
//     `.limit()`. Without that, `await …where()` yields the chain object and
//     `.length` is `undefined`, so the next attempt number would be `undefined`
//     rather than `attempts`.
//
// The chain therefore IS a promise — methods hung on a real `Promise` — rather
// than an object carrying a hand-written `then`. Same behaviour, and it does
// not hand-roll a thenable (which `lint/suspicious/noThenProperty` rejects, on
// the grounds that an object with a `then` is indistinguishable from a promise
// to everything that awaits it).
const createSelectChain = (
  resolveValue: unknown[],
  /** Rows the un-limited form resolves to — i.e. this slot's existing cuts. */
  attemptRows: unknown[] = [{ id: 'attempt_123' }]
) => {
  const chain = Promise.resolve(attemptRows) as Promise<unknown[]> &
    Record<string, ReturnType<typeof vi.fn>>;
  for (const m of ['from', 'innerJoin', 'where'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

const createUpdateChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

const createInsertChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

let selectChain: ReturnType<typeof createSelectChain>;
let updateChain: ReturnType<typeof createUpdateChain>;
let insertChain: ReturnType<typeof createInsertChain>;

// No `graphic` or `organization` reads any more: loading the source graphic and
// resolving the brand colour moved into `regenerateGraphic` along with the rest
// of the render.
const queryFns = {
  video: { findFirst: vi.fn() },
  contentItem: { findFirst: vi.fn() },
  // Regenerating settles the batch's status, which reads the batch back.
  contentBatch: { findFirst: vi.fn() },
};

const mockDb = {
  select: vi.fn().mockImplementation(() => selectChain),
  update: vi.fn().mockImplementation(() => updateChain),
  insert: vi.fn().mockImplementation(() => insertChain),
  delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  // The graphic path appends the cut and moves the slot's pointer together, so
  // the mock has to be able to open a transaction. The callback receives the
  // same mock — that is what puts both writes on `insertChain`/`updateChain`.
  transaction: vi.fn(async (cb: (trx: unknown) => unknown) => cb(mockDb)),
  query: queryFns,
};

const validInput = {
  itemId: 'item_123',
  organizationId: 'org_123',
  createdById: 'user_123',
  reason: 'make it punchier',
};

import {
  attemptFixture,
  settleNoopBatch,
  slotFixture,
} from '../_shared/test-fixtures.js';

// The SLOT: what the post is and what has been decided about it.
const baseItem = slotFixture({
  id: 'item_123',
  batchId: 'batch_123',
  position: 1,
  scheduledAt: new Date('2026-07-01T10:00:00Z'),
  targetPageIds: ['page_1'],
  videoIdea: { topic: 'Glow up' } as never,
});

const videoItem = { ...baseItem, kind: 'video' as const };
const graphicItem = { ...baseItem, kind: 'graphic' as const };

// The CUT: the asset and the words a re-roll replaces.
const videoAttempt = attemptFixture({
  slotId: 'item_123',
  batchId: 'batch_123',
  videoId: 'vid_1',
  caption: 'Original caption',
});
const graphicAttempt = attemptFixture({
  slotId: 'item_123',
  batchId: 'batch_123',
  videoId: null,
  graphicId: 'gfx_1',
  caption: 'Original caption',
});

describe('regenerateBatchItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockPlanVideoDetail = (
      vi.spyOn(
        planVideoDetailModule,
        'planVideoDetail'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
    hoisted.mockRegenerateGraphic = (
      vi.spyOn(
        regenerateGraphicModule,
        'regenerateGraphic'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
    selectChain = createSelectChain([]);
    updateChain = createUpdateChain([{ id: 'item_123' }]);
    insertChain = createInsertChain([{ id: 'new_gfx' }]);
    for (const q of Object.values(queryFns)) q.findFirst.mockReset();
    queryFns.contentBatch.findFirst.mockResolvedValue(settleNoopBatch);
  });

  afterEach(() => {
    hoisted.mockPlanVideoDetail.mockRestore();
    hoisted.mockRegenerateGraphic.mockRestore();
  });

  // ── Validation / guards ────────────────────────────────────────────────
  it('returns VALIDATION_ERROR when itemId is empty', async () => {
    await expectResult(
      regenerateBatchItem(mockDb as never, { ...validInput, itemId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the item belongs to another org', async () => {
    selectChain = createSelectChain([
      { slot: videoItem, attempt: videoAttempt },
    ]);
    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE when the item is no longer pending', async () => {
    selectChain = createSelectChain([
      {
        slot: { ...videoItem, reviewStatus: 'accepted' },
        attempt: videoAttempt,
      },
    ]);
    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('keeps regenerating past what used to be the cap', async () => {
    // There is no ceiling. `regenerationCount` is a SPEND METER now, not a
    // budget: it is still incremented and still shown, but it never refuses.
    // A hard stop punished the owner most likely to ship something good —
    // the one still trying — by leaving them with the cut they had rejected.
    selectChain = createSelectChain([
      {
        slot: { ...videoItem, regenerationCount: 7 },
        attempt: videoAttempt,
      },
    ]);
    queryFns.video.findFirst.mockResolvedValueOnce({
      id: 'vid_1',
      organizationId: 'org_123',
      serviceId: 'svc_1',
      templateId: 'tmpl_1',
      variationId: 'caption-tease-1',
      draftConfig: null,
    });
    hoisted.mockPlanVideoDetail.mockResolvedValueOnce(
      ok({ itemId: 'item_123', videoId: 'vid_2' })
    );
    queryFns.contentItem.findFirst.mockResolvedValueOnce({
      ...videoItem,
      currentAttemptId: 'attempt_new',
      regenerationCount: 8,
    });

    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toSucceedWith((d) => {
      expect(d.regenerationCount).toBe(8);
    });
  });

  // ── Video branch (the new path) ────────────────────────────────────────
  it('regenerates a video via planVideoDetail with a refinement-aware block', async () => {
    selectChain = createSelectChain([
      { slot: videoItem, attempt: videoAttempt },
    ]);
    queryFns.video.findFirst.mockResolvedValueOnce({
      id: 'vid_1',
      organizationId: 'org_123',
      serviceId: 'svc_1',
      templateId: 'tmpl_1',
      variationId: 'caption-tease-1',
      title: 'Old title',
      draftConfig: {
        captionTease: { headline: 'Old', caption: 'Read' },
        // Deliberately out of order, to prove the caller sorts by `order`
        // rather than trusting array position.
        bRollClips: [
          { assetId: 'asset_b', order: 1, clipType: 'bRoll' },
          { assetId: 'asset_a', order: 0, clipType: 'bRoll' },
        ],
      },
    });
    // `planVideoDetail` appends the cut and moves the pointer itself, so the
    // id it hands back is the SLOT it was given — not a replacement row.
    hoisted.mockPlanVideoDetail.mockResolvedValueOnce(
      ok({ itemId: 'item_123', videoId: 'vid_2' })
    );
    queryFns.contentItem.findFirst.mockResolvedValueOnce({
      ...videoItem,
      currentAttemptId: 'attempt_new',
      regenerationCount: 1,
    });

    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toSucceedWith((d) => {
      expect(d.videoId).toBe('vid_2');
      // The post keeps its id across a re-roll — that is the point. The
      // client's `activeItemId` stays valid, and so does the thread hanging
      // off it.
      expect(d.id).toBe('item_123');
      expect(d.attemptId).toBe('attempt_new');
      expect(d.attemptNumber).toBe(1);
      expect(d.regenerationCount).toBe(1);
    });

    // The prior copy block + instruction + supersession are threaded through.
    expect(hoisted.mockPlanVideoDetail).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        templateId: 'tmpl_1',
        variationId: 'caption-tease-1',
        position: 1,
        regeneration: expect.objectContaining({
          slotId: 'item_123',
          attemptNumber: 1,
          regenerationCount: 1,
          refinementInstruction: 'make it punchier',
          priorCopy: { headline: 'Old', caption: 'Read' },
          reuseCaption: 'Original caption',
          reuseVideoIdea: { topic: 'Glow up' },
          // CAPABILITY: a copy edit keeps its footage.
          //
          // Clip selection is a least-recently-used claim that stamps as it
          // claims, so without these ids the planner is steered AWAY from the
          // clips the original used and "make it punchier" returns a video
          // with different b-roll. Ordered by `order`, not array position.
          intent: 'copy',
          priorClipAssetIds: ['asset_a', 'asset_b'],
        }),
      })
    );
    // No supersession bookkeeping left: nothing to flip to 'regenerated',
    // nothing to copy forward, no orphan to unwind. The video path writes no
    // content_batch_item row of its own at all.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the source video is missing', async () => {
    selectChain = createSelectChain([
      { slot: videoItem, attempt: videoAttempt },
    ]);
    queryFns.video.findFirst.mockResolvedValueOnce(undefined);
    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(hoisted.mockPlanVideoDetail).not.toHaveBeenCalled();
  });

  it('surfaces INTERNAL_ERROR when planVideoDetail fails', async () => {
    selectChain = createSelectChain([
      { slot: videoItem, attempt: videoAttempt },
    ]);
    queryFns.video.findFirst.mockResolvedValueOnce({
      id: 'vid_1',
      organizationId: 'org_123',
      serviceId: 'svc_1',
      templateId: 'tmpl_1',
      variationId: 'caption-tease-1',
      draftConfig: null,
    });
    hoisted.mockPlanVideoDetail.mockResolvedValueOnce(
      err(new FeatureError(ErrorCodes.INTERNAL_ERROR, 'render boom'))
    );
    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('returns CONFLICT when the slot stops being pending mid-flight', async () => {
    // The race the old code fought with a delete-the-orphan unwind: someone
    // accepts the post while its replacement render is being prepared. The
    // guard is the same `reviewStatus = 'pending'` predicate on the pointer
    // move, but losing it now costs nothing — the attempt was inserted inside
    // the same transaction, so throwing rolls it back.
    selectChain = createSelectChain([
      { slot: graphicItem, attempt: graphicAttempt },
    ]);
    hoisted.mockRegenerateGraphic.mockResolvedValueOnce(
      ok({ id: 'new_gfx', status: 'rendering' })
    );
    updateChain = createUpdateChain([]); // race: the pointer move matched no row

    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);

    // The replacement graphic is deliberately NOT deleted. Its render is
    // already enqueued by this point — `regenerateGraphic` inserts and
    // enqueues together — so deleting the row would leave a running worker
    // writing outputs to a graphic that no longer exists. It is orphaned in
    // the library instead.
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // ── Graphic branch: delegate the render, own the slot ──────────────────
  it('settles the batch — a re-roll puts it back to generating', async () => {
    // The direction a one-way "it's done" flag would get wrong: the new cut is
    // rendering, so a batch that had reached 'review' is working again.
    queryFns.contentBatch.findFirst.mockResolvedValue({
      id: 'batch_123',
      status: 'review',
      items: [
        {
          id: 'item_123',
          kind: 'graphic',
          reviewStatus: 'pending',
          currentAttempt: {
            id: 'attempt_1',
            graphic: { status: 'rendering' },
            video: null,
          },
        },
      ],
    });
    selectChain = createSelectChain([
      { slot: graphicItem, attempt: graphicAttempt },
    ]);
    insertChain = createInsertChain([{ id: 'new_gfx' }]);
    updateChain = createUpdateChain([{ ...graphicItem, regenerationCount: 1 }]);
    hoisted.mockRegenerateGraphic.mockResolvedValueOnce(
      ok({ id: 'new_gfx', status: 'rendering' })
    );

    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toSucceedWith();

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'generating' })
    );
  });

  it('delegates the render to regenerateGraphic and appends the cut', async () => {
    selectChain = createSelectChain([
      { slot: graphicItem, attempt: graphicAttempt },
    ]);
    insertChain = createInsertChain([{ id: 'new_gfx' }]);
    // The pointer move returns the SLOT — same id, one more cut against it.
    updateChain = createUpdateChain([{ ...graphicItem, regenerationCount: 1 }]);
    hoisted.mockRegenerateGraphic.mockResolvedValueOnce(
      ok({ id: 'new_gfx', status: 'rendering' })
    );

    await expectResult(
      regenerateBatchItem(mockDb as never, validInput)
    ).toSucceedWith((d) => {
      expect(d.id).toBe('item_123');
      expect(d.attemptNumber).toBe(1);
      expect(d.graphicId).toBe('new_gfx');
    });

    // This service hands over the SOURCE graphic and the instruction, and
    // nothing else. Template pinning, prior-image anchoring, per-slide refine
    // and the render enqueue are `regenerateGraphic`'s job and are asserted in
    // ITS test — which is the whole point of the delegation. This used to be
    // re-implemented here, and the copy had already drifted.
    expect(hoisted.mockRegenerateGraphic).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        graphicId: 'gfx_1',
        organizationId: 'org_123',
        refinementInstruction: 'make it punchier',
        contentBatchId: 'batch_123',
        scope: 'all',
      })
    );

    // The appended cut carries the words forward — a graphic re-roll changes
    // the picture, not the post — and clears any staged proposal on the slot.
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: 'item_123',
        attemptNumber: 1,
        caption: 'Original caption',
        regenerationReason: 'make it punchier',
      })
    );
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        regenerationCount: 1,
        pendingRegenerate: null,
      })
    );
  });

  it('asks for a single-slide refine when given a slideIndex', async () => {
    selectChain = createSelectChain([
      { slot: graphicItem, attempt: graphicAttempt },
    ]);
    insertChain = createInsertChain([{ id: 'new_gfx' }]);
    updateChain = createUpdateChain([{ ...graphicItem, regenerationCount: 1 }]);
    hoisted.mockRegenerateGraphic.mockResolvedValueOnce(
      ok({ id: 'new_gfx', status: 'rendering' })
    );

    await expectResult(
      regenerateBatchItem(mockDb as never, { ...validInput, slideIndex: 1 })
    ).toSucceedWith(() => {});

    // The one mapping this service still owns: "the owner pointed at slide 2"
    // becomes the scope the shared re-roll understands. Coercing a slide scope
    // on a non-carousel is `regenerateGraphic`'s call, not this one's.
    expect(hoisted.mockRegenerateGraphic).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ scope: 'slide', slideIndex: 1 })
    );
  });
});
