import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { joinedRow, settleNoopQuery } from '../_shared/test-fixtures.js';
import { rejectBatchItem } from './reject-batch-item.service.js';

// The service runs:
// 1. db.select().from().innerJoin().where().limit() → joined row(s)
// 2. db.update().set().where().returning() → updated row(s)
// Each top-level call (`select`, `update`) returns its own chain so we can
// resolve them independently per test.
const createSelectChain = (resolveValue: unknown[]) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'innerJoin', 'where'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue(resolveValue);
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

let selectChain: ReturnType<typeof createSelectChain>;
let updateChain: ReturnType<typeof createUpdateChain>;

const mockDb = {
  select: vi.fn().mockImplementation(() => selectChain),
  update: vi.fn().mockImplementation(() => updateChain),
  // Rejecting settles the batch's status, which reads the batch back.
  query: settleNoopQuery(),
};

const validInput = {
  itemId: 'item_123',
  organizationId: 'org_123',
};

const pendingRow = {
  id: 'item_123',
  batchId: 'batch_123',
  reviewStatus: 'pending' as const,
  decidedAt: null,
};

describe('rejectBatchItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain = createSelectChain([]);
    updateChain = createUpdateChain([]);
  });

  it('marks a pending item as rejected', async () => {
    selectChain = createSelectChain([joinedRow({ slot: pendingRow })]);
    const rejectedRow = {
      ...pendingRow,
      reviewStatus: 'rejected' as const,
      decidedAt: new Date(),
    };
    updateChain = createUpdateChain([rejectedRow]);

    const data = await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toSucceedWith((d) => {
      expect(d.reviewStatus).toBe('rejected');
      expect(d.decidedAt).toBeInstanceOf(Date);
    });

    expect(data.id).toBe('item_123');
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: 'rejected' })
    );
  });

  it('settles the batch after the decision — the last reject completes it', async () => {
    // Guards the settle call itself: without it the batch sticks on
    // 'generating' after the queue empties, which is ENG-788.
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce({
      id: 'batch_123',
      status: 'review',
      items: [
        {
          id: 'item_123',
          kind: 'video',
          reviewStatus: 'rejected',
          currentAttempt: {
            id: 'attempt_123',
            video: { status: 'ready' },
            graphic: null,
          },
        },
      ],
    });
    selectChain = createSelectChain([joinedRow({ slot: pendingRow })]);
    updateChain = createUpdateChain([
      {
        ...pendingRow,
        reviewStatus: 'rejected' as const,
        decidedAt: new Date(),
      },
    ]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toSucceedWith();

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('returns VALIDATION_ERROR when itemId is empty', async () => {
    await expectResult(
      rejectBatchItem(mockDb as never, {
        itemId: '',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when organizationId is empty', async () => {
    await expectResult(
      rejectBatchItem(mockDb as never, {
        itemId: 'item_123',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the item does not exist', async () => {
    selectChain = createSelectChain([]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the item belongs to another organization', async () => {
    selectChain = createSelectChain([]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the item was already accepted', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingRow, reviewStatus: 'accepted' },
      }),
    ]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the item was already rejected', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingRow, reviewStatus: 'rejected' },
      }),
    ]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE when the item was already regenerated', async () => {
    selectChain = createSelectChain([
      joinedRow({
        slot: { ...pendingRow, reviewStatus: 'regenerated' },
      }),
    ]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when a concurrent update wins the race', async () => {
    // Row reads as pending, but the UPDATE ... WHERE reviewStatus='pending'
    // returns nothing because another writer already moved it.
    selectChain = createSelectChain([joinedRow({ slot: pendingRow })]);
    updateChain = createUpdateChain([]);

    await expectResult(
      rejectBatchItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });
});
