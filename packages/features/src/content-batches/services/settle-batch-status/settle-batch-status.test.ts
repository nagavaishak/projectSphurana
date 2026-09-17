import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  settleBatchForAsset,
  settleBatchStatus,
} from './settle-batch-status.service.js';

const mockDb = createMockDatabase();

/** A slot in the shape the settle query returns it. */
const slot = (
  reviewStatus: string,
  kind: 'graphic' | 'video',
  assetStatus: string | null
) => ({
  id: `slot_${reviewStatus}_${assetStatus}`,
  kind,
  reviewStatus,
  currentAttempt: {
    id: 'attempt_1',
    graphic: kind === 'graphic' ? { status: assetStatus } : null,
    video: kind === 'video' ? { status: assetStatus } : null,
  },
});

const givenBatch = (status: string, items: unknown[]) => {
  mockDb.query.contentBatch.findFirst.mockResolvedValueOnce({
    id: 'batch_1',
    status,
    items,
  });
};

/** The conditional UPDATE ... RETURNING that claims the transition. */
const givenWriteWins = () =>
  mockDb.returning.mockResolvedValueOnce([{ id: 'batch_1' }]);
const givenWriteLoses = () => mockDb.returning.mockResolvedValueOnce([]);

describe('settleBatchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('moves a fully-rendered batch to review — the ENG-788 case', async () => {
    // Every asset is ready and the queue is untouched: the batch is done
    // generating and nothing but the owner's attention is outstanding. This
    // used to sit on 'generating' for the life of the batch, so the settings
    // readout said "generating" about finished content.
    givenBatch('generating', [
      slot('pending', 'graphic', 'ready'),
      slot('pending', 'video', 'ready'),
    ]);
    givenWriteWins();

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('review');
      expect(result.data.changed).toBe(true);
      expect(result.data.pending).toBe(2);
      expect(result.data.rendering).toBe(0);
    }
  });

  it('holds at generating while one render is outstanding', async () => {
    givenBatch('generating', [
      slot('pending', 'graphic', 'ready'),
      slot('pending', 'video', 'rendering'),
    ]);

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('generating');
      expect(result.data.changed).toBe(false);
      expect(result.data.rendering).toBe(1);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('counts a failed render as done, not as outstanding', async () => {
    // Otherwise one failed asset pins the batch on 'generating' forever — the
    // owner can only reject or regenerate it from the review queue.
    givenBatch('generating', [slot('pending', 'graphic', 'failed')]);
    givenWriteWins();

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) expect(result.data.status).toBe('review');
  });

  it('treats a missing asset status as outstanding, never as ready', async () => {
    // A slot whose asset row has not landed yet is work in flight. Guessing
    // "ready" here would announce a batch that is not.
    givenBatch('generating', [slot('pending', 'graphic', null)]);

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) {
      expect(result.data.status).toBe('generating');
      expect(result.data.rendering).toBe(1);
    }
  });

  it('completes a batch once nothing is left pending', async () => {
    givenBatch('review', [
      slot('accepted', 'graphic', 'ready'),
      slot('rejected', 'video', 'ready'),
    ]);
    givenWriteWins();

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) {
      expect(result.data.status).toBe('completed');
      expect(result.data.pending).toBe(0);
    }
  });

  it('reopens a completed batch that is rendering again', async () => {
    // A regenerate after review puts a slot back into rendering. Settling in
    // both directions is what stops the stored status from drifting.
    givenBatch('review', [slot('pending', 'video', 'rendering')]);
    givenWriteWins();

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) expect(result.data.status).toBe('generating');
  });

  it('never settles a batch that is still seeding', async () => {
    // 'planning' means slots are still being inserted — the ones on the table
    // are not the whole batch, so "all rendered" would be a few slots early.
    givenBatch('planning', [slot('pending', 'graphic', 'ready')]);

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) {
      expect(result.data.status).toBe('planning');
      expect(result.data.changed).toBe(false);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('never resurrects a failed batch', async () => {
    givenBatch('failed', []);

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) expect(result.data.status).toBe('failed');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('leaves an empty batch alone rather than calling it completed', async () => {
    // "No items" is a moment DURING seeding, not a finished batch with nothing
    // in it. Completing here would re-arm the create button mid-seed.
    givenBatch('generating', []);

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) expect(result.data.status).toBe('generating');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('reports changed=false when a concurrent finisher already settled', async () => {
    // Both renders land at once and both compute 'review'. The write is
    // conditional on the status we read, so only one claims the transition —
    // which is what lets a caller act on `changed` without deduplicating.
    givenBatch('generating', [slot('pending', 'graphic', 'ready')]);
    givenWriteLoses();

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'batch_1',
    });

    if (result.success) {
      expect(result.data.changed).toBe(false);
      expect(result.data.status).toBe('generating');
    }
  });

  it('settles the batch a just-rendered graphic belongs to', async () => {
    // The worker's entry point: it knows the asset it finished, not the batch.
    mockDb.query.contentAttempt.findFirst.mockResolvedValueOnce({
      batchId: 'batch_1',
    });
    givenBatch('generating', [slot('pending', 'graphic', 'ready')]);
    givenWriteWins();

    const result = await settleBatchForAsset(mockDb as never, {
      graphicId: 'gfx_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.status).toBe('review');
  });

  it('is a no-op for standalone content that belongs to no batch', async () => {
    // The worker renders batch slots and one-off assets through the same path
    // and cannot tell them apart at the call site.
    mockDb.query.contentAttempt.findFirst.mockResolvedValueOnce({
      batchId: null,
    });

    const result = await settleBatchForAsset(mockDb as never, {
      videoId: 'vid_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
    expect(mockDb.query.contentBatch.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a call naming both an asset kind, or neither', async () => {
    for (const input of [
      { graphicId: 'g', videoId: 'v' },
      {} as { graphicId?: string },
    ]) {
      const result = await settleBatchForAsset(mockDb as never, input);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND for a batch that does not exist', async () => {
    mockDb.query.contentBatch.findFirst.mockResolvedValueOnce(null);

    const result = await settleBatchStatus(mockDb as never, {
      batchId: 'nope',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
