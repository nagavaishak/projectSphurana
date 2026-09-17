import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  attemptFixture,
  settleNoopQuery,
  slotFixture,
} from '../_shared/test-fixtures.js';

import { undoRegenerate } from './undo-regenerate.service.js';

// The service runs, in order:
//   1. loadPendingSlotForOrg → select().from().innerJoin().innerJoin().where().limit()
//   2. the previous attempt   → select().from().where().orderBy().limit()
//   3. one further back?      → select().from().where().limit()
//   4. transaction: update().set().where().returning() + insert().values()
//
// All three selects come off the same mock, so `limit` is fed a QUEUE rather
// than a single value — otherwise step 2 would see step 1's joined row.
const createSelectChain = (queued: unknown[][]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'innerJoin', 'where', 'orderBy'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  const queue = [...queued];
  chain.limit = vi.fn().mockImplementation(() => {
    return Promise.resolve(queue.shift() ?? []);
  });
  return chain;
};

const createUpdateChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['set', 'where'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.returning = vi.fn().mockResolvedValue(resolveValue);
  return chain;
};

const createInsertChain = () => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.values = vi.fn().mockResolvedValue([]);
  return chain;
};

let selectChain: ReturnType<typeof createSelectChain>;
let updateChain: ReturnType<typeof createUpdateChain>;
let insertChain: ReturnType<typeof createInsertChain>;

const mockDb = {
  select: vi.fn().mockImplementation(() => selectChain),
  update: vi.fn().mockImplementation(() => updateChain),
  insert: vi.fn().mockImplementation(() => insertChain),
  transaction: vi.fn(async (cb: (trx: unknown) => unknown) => cb(mockDb)),
  // Undo settles the batch's status, which reads the batch back.
  query: settleNoopQuery(),
};

const slot = slotFixture({
  kind: 'video',
  currentAttemptId: 'attempt_2',
  regenerationCount: 2,
});

// On screen: the second re-roll.
const currentAttempt = attemptFixture({
  id: 'attempt_2',
  attemptNumber: 2,
  videoId: 'vid_2',
  caption: 'Third caption',
});

// What undo goes back to.
const previousAttempt = attemptFixture({
  id: 'attempt_1',
  attemptNumber: 1,
  videoId: 'vid_1',
  caption: 'Second caption',
});

const joined = (overrides: { slot?: unknown; attempt?: unknown } = {}) => [
  {
    slot: overrides.slot ?? slot,
    attempt: overrides.attempt ?? currentAttempt,
  },
];

const validInput = { itemId: 'item_123', organizationId: 'org_123' };

describe('undoRegenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain = createSelectChain([[]]);
    updateChain = createUpdateChain([slot]);
    insertChain = createInsertChain();
  });

  it('returns VALIDATION_ERROR when itemId is empty', async () => {
    await expectResult(
      undoRegenerate(mockDb as never, { ...validInput, itemId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the slot belongs to another org', async () => {
    // Ownership is a WHERE predicate on content_item.organization_id now, not a
    // comparison after the fact, so a foreign org returns no row at all.
    selectChain = createSelectChain([[]]);
    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the post has already been decided', async () => {
    selectChain = createSelectChain([
      joined({ slot: { ...slot, reviewStatus: 'accepted' } }),
    ]);
    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INVALID_STATE when the post has never been regenerated', async () => {
    // Attempt 0 is on screen and nothing precedes it.
    selectChain = createSelectChain([
      [
        {
          slot: { ...slot, currentAttemptId: 'attempt_123' },
          attempt: attemptFixture({ attemptNumber: 0 }),
        },
      ],
      [], // no earlier attempt
    ]);
    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('moves the pointer back one cut without refunding the count', async () => {
    selectChain = createSelectChain([
      joined(),
      [previousAttempt],
      [{ id: 'attempt_0' }], // one further back still exists
    ]);

    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toSucceedWith((d) => {
      // The post keeps its id — an undo is a pointer move, not a new post.
      expect(d.id).toBe('item_123');
      expect(d.attemptId).toBe('attempt_1');
      expect(d.attemptNumber).toBe(1);
      // The previous cut brings its own asset AND its own words back.
      expect(d.videoId).toBe('vid_1');
      expect(d.caption).toBe('Second caption');
      // Pressable again: attempt 0 is still behind it.
      expect(d.canUndoRegenerate).toBe(true);
    });

    // No refund: `regenerationCount` records renders actually paid for, so
    // stepping back over one must not un-spend it.
    expect(updateChain.set).toHaveBeenCalledWith({
      currentAttemptId: 'attempt_1',
    });
    expect(updateChain.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ regenerationCount: expect.anything() })
    );
  });

  it('settles the batch — undoing onto a rendered cut makes it reviewable', async () => {
    // The reopen direction: a batch that was waiting on the re-roll is ready
    // to review again the moment the pointer moves back to a finished cut.
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce({
      id: 'batch_123',
      status: 'generating',
      items: [
        {
          id: 'item_123',
          kind: 'video',
          reviewStatus: 'pending',
          currentAttempt: {
            id: 'attempt_1',
            video: { status: 'ready' },
            graphic: null,
          },
        },
      ],
    });
    selectChain = createSelectChain([
      joined(),
      [previousAttempt],
      [{ id: 'attempt_0' }],
    ]);

    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toSucceedWith();

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'review' })
    );
  });

  it('reports canUndoRegenerate false at the first cut', async () => {
    selectChain = createSelectChain([
      joined(),
      [attemptFixture({ id: 'attempt_0', attemptNumber: 0 })],
      [], // nothing before attempt 0
    ]);

    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toSucceedWith((d) => {
      expect(d.attemptNumber).toBe(0);
      expect(d.canUndoRegenerate).toBe(false);
    });
  });

  it('records the revert in the review thread, in the same transaction', async () => {
    selectChain = createSelectChain([joined(), [previousAttempt], []]);

    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toSucceedWith(() => {});

    expect(mockDb.transaction).toHaveBeenCalled();
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item_123',
        role: 'assistant',
        // The thread's caption history has to follow the pointer, or a later
        // revert-to-version would restore words that are no longer on screen.
        captionSnapshot: 'Second caption',
      })
    );
  });

  it('returns CONFLICT when the slot moved under the undo', async () => {
    selectChain = createSelectChain([joined(), [previousAttempt], []]);
    // A concurrent regenerate (or accept) means the guarded update matches
    // nothing — and the thread message rolls back with it.
    updateChain = createUpdateChain([]);

    await expectResult(
      undoRegenerate(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(insertChain.values).not.toHaveBeenCalled();
  });
});
