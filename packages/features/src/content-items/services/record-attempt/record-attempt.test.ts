import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { recordAttempt } from './record-attempt.js';

const ORG = 'org_1';
const ITEM = 'item_1';

// recordAttempt runs, all inside one transaction:
//   1. select().from().where().limit()             → the slot
//   2. select().from().where().orderBy().limit()   → the highest attempt number
//   3. insert().values().returning()               → the new attempt
//   4. update().set().where()                      → the pointer + the meter
const makeDb = (opts: {
  slot?: Record<string, unknown> | null;
  latestAttemptNumber?: number | null;
  insertError?: Error;
}) => {
  const selectResults = [
    opts.slot === null
      ? []
      : [opts.slot ?? { id: ITEM, batchId: null, regenerationCount: 0 }],
    opts.latestAttemptNumber === null || opts.latestAttemptNumber === undefined
      ? []
      : [{ attemptNumber: opts.latestAttemptNumber }],
  ];
  let selectCall = 0;

  const insertedValues: Record<string, unknown>[] = [];
  const updatedSets: Record<string, unknown>[] = [];

  const selectChain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'where', 'orderBy'] as const) {
    selectChain[m] = vi.fn().mockReturnValue(selectChain);
  }
  selectChain.limit = vi
    .fn()
    .mockImplementation(async () => selectResults[selectCall++] ?? []);

  const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
  insertChain.values = vi
    .fn()
    .mockImplementation((v: Record<string, unknown>) => {
      if (opts.insertError) throw opts.insertError;
      insertedValues.push(v);
      return insertChain;
    });
  insertChain.returning = vi
    .fn()
    .mockImplementation(async () => [insertedValues.at(-1)]);

  const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
  updateChain.set = vi.fn().mockImplementation((v: Record<string, unknown>) => {
    updatedSets.push(v);
    return updateChain;
  });
  updateChain.where = vi.fn().mockResolvedValue(undefined);

  const db: Record<string, unknown> = {
    select: vi.fn(() => selectChain),
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
    transaction: vi.fn(async (cb: (trx: unknown) => unknown) => cb(db)),
  };

  return { db, insertedValues, updatedSets };
};

describe('recordAttempt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends the next attempt number and moves the pointer', async () => {
    const { db, insertedValues, updatedSets } = makeDb({
      slot: { id: ITEM, batchId: 'batch_1', regenerationCount: 2 },
      latestAttemptNumber: 2,
    });

    const result = await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
      graphicId: 'graphic_9',
      reason: 'make the headline shorter',
    });

    await expectResult(result).toSucceedWith();
    expect(insertedValues[0]).toMatchObject({
      slotId: ITEM,
      organizationId: ORG,
      attemptNumber: 3,
      graphicId: 'graphic_9',
      videoId: null,
      regenerationReason: 'make the headline shorter',
    });
    expect(updatedSets[0]).toMatchObject({
      currentAttemptId: insertedValues[0].id,
      regenerationCount: 3,
    });
  });

  it('inherits batchId from the item rather than taking it from the caller', async () => {
    const { db, insertedValues } = makeDb({
      slot: { id: ITEM, batchId: 'batch_7', regenerationCount: 0 },
      latestAttemptNumber: 0,
    });

    await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
      videoId: 'video_1',
    });

    expect(insertedValues[0]).toMatchObject({ batchId: 'batch_7' });
  });

  it('records a standalone item with a null batch', async () => {
    const { db, insertedValues } = makeDb({
      slot: { id: ITEM, batchId: null, regenerationCount: 0 },
      latestAttemptNumber: 0,
    });

    const result = await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
      videoId: 'video_1',
    });

    await expectResult(result).toSucceedWith();
    expect(insertedValues[0]).toMatchObject({
      batchId: null,
      attemptNumber: 1,
    });
  });

  it('returns NOT_FOUND for another org, without saying the item exists', async () => {
    const { db } = makeDb({ slot: null });

    const result = await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: 'someone_else',
      videoId: 'video_1',
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  it('rejects an attempt carrying neither asset', async () => {
    const { db } = makeDb({});

    const result = await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects an attempt carrying both assets', async () => {
    const { db } = makeDb({});

    const result = await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
      videoId: 'video_1',
      graphicId: 'graphic_1',
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // Two people pressing regenerate at once is a conflict the caller can act on,
  // not an internal error — the unique index is what stops the second one
  // silently overwriting the first one's history.
  it('maps the attempt-number unique violation to CONFLICT', async () => {
    const { db } = makeDb({
      slot: { id: ITEM, batchId: null, regenerationCount: 0 },
      latestAttemptNumber: 0,
      insertError: new Error(
        'duplicate key value violates unique constraint "idx_content_attempt_slot_number"'
      ),
    });

    const result = await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
      videoId: 'video_1',
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
    });
  });

  it('starts at 0 when the item somehow has no attempts', async () => {
    const { db, insertedValues } = makeDb({
      slot: { id: ITEM, batchId: null, regenerationCount: 0 },
      latestAttemptNumber: null,
    });

    await recordAttempt(db as never, {
      itemId: ITEM,
      organizationId: ORG,
      videoId: 'video_1',
    });

    expect(insertedValues[0]).toMatchObject({ attemptNumber: 0 });
  });
});
