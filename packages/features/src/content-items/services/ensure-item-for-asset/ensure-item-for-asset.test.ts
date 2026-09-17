import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
// Spy the SOURCE module, not the barrel: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import { ErrorCodes } from '../../../shared/index.js';
import * as insertSlotModule from '../insert-slot/insert-slot.js';
import { ensureItemForAsset } from './ensure-item-for-asset.js';

const ORG = 'org_1';

const makeDb = (rows: { slotId: string }[][]) => {
  let call = 0;
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'where'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockImplementation(async () => rows[call++] ?? []);
  return { select: vi.fn(() => chain) };
};

describe('ensureItemForAsset', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the existing item without creating one', async () => {
    const insert = vi.spyOn(insertSlotModule, 'insertSlotWithFirstAttempt');
    const db = makeDb([[{ slotId: 'item_existing' }]]);

    const result = await ensureItemForAsset(db as never, {
      organizationId: ORG,
      graphicId: 'graphic_1',
      source: 'claire_chat',
    });

    const data = await expectResult(result).toSucceedWith();
    expect(data).toMatchObject({ itemId: 'item_existing', adopted: false });
    expect(insert).not.toHaveBeenCalled();
  });

  // The asset predates item tracking. Rather than backfilling every historical
  // graphic, it joins the model on first edit: attempt 0 IS what already
  // existed.
  it('adopts an untracked asset as attempt 0 of a new standalone item', async () => {
    const insert = vi
      .spyOn(insertSlotModule, 'insertSlotWithFirstAttempt')
      .mockResolvedValue({ slotId: 'item_new', attemptId: 'attempt_0' });
    const db = makeDb([[]]);

    const result = await ensureItemForAsset(db as never, {
      organizationId: ORG,
      graphicId: 'graphic_1',
      source: 'claire_chat',
    });

    const data = await expectResult(result).toSucceedWith();
    expect(data).toMatchObject({ itemId: 'item_new', adopted: true });
    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        // Standalone by construction — an asset inside a batch already has an
        // item, so reaching adoption means it has none.
        batchId: null,
        position: null,
        source: 'claire_chat',
        kind: 'graphic',
        graphicId: 'graphic_1',
      })
    );
  });

  it('adopts a video with kind=video', async () => {
    vi.spyOn(insertSlotModule, 'insertSlotWithFirstAttempt').mockResolvedValue({
      slotId: 'item_new',
      attemptId: 'attempt_0',
    });
    const db = makeDb([[]]);

    await ensureItemForAsset(db as never, {
      organizationId: ORG,
      videoId: 'video_1',
      source: 'content_studio',
    });

    expect(insertSlotModule.insertSlotWithFirstAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'video', videoId: 'video_1' })
    );
  });

  // Two edits on the same untracked asset race to adopt it. Neither should
  // fail: whoever won owns the item and both callers point at it.
  it('re-reads and yields to the winner when two adoptions race', async () => {
    vi.spyOn(insertSlotModule, 'insertSlotWithFirstAttempt').mockRejectedValue(
      new Error('insert lost the race')
    );
    const db = makeDb([[], [{ slotId: 'item_winner' }]]);

    const result = await ensureItemForAsset(db as never, {
      organizationId: ORG,
      graphicId: 'graphic_1',
      source: 'claire_chat',
    });

    const data = await expectResult(result).toSucceedWith();
    expect(data).toMatchObject({ itemId: 'item_winner', adopted: false });
  });

  it('reports INTERNAL_ERROR when the insert failed for a real reason', async () => {
    vi.spyOn(insertSlotModule, 'insertSlotWithFirstAttempt').mockRejectedValue(
      new Error('connection terminated')
    );
    const db = makeDb([[], []]);

    const result = await ensureItemForAsset(db as never, {
      organizationId: ORG,
      graphicId: 'graphic_1',
      source: 'claire_chat',
    });

    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });
  });

  it('refuses an asset that is neither a graphic nor a video', async () => {
    const db = makeDb([]);
    const result = await ensureItemForAsset(db as never, {
      organizationId: ORG,
      source: 'claire_chat',
    });
    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('refuses an asset claiming to be both', async () => {
    const db = makeDb([]);
    const result = await ensureItemForAsset(db as never, {
      organizationId: ORG,
      graphicId: 'graphic_1',
      videoId: 'video_1',
      source: 'claire_chat',
    });
    await expectResult(result).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
