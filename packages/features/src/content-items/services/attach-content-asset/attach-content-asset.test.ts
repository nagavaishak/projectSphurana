import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
// Spy the SOURCE modules, not their barrels: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import * as loadSlotModule from '../load-slot/load-slot.js';
import * as recordAttemptModule from '../record-attempt/record-attempt.js';
import { attachContentAsset } from './attach-content-asset.js';

const ITEM_ID = 'item-1';
const ORG_ID = 'org-1';

function createMockDb() {
  const chain: Record<string, unknown> = {};
  const updates: Record<string, unknown>[] = [];
  chain.update = vi.fn(() => chain);
  chain.set = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    return chain;
  });
  chain.where = vi.fn(() => Promise.resolve([]));
  return { db: chain, updates };
}

const loadedAttempt = (attempt: Record<string, unknown>) =>
  vi.spyOn(loadSlotModule, 'loadSlotForOrg').mockResolvedValue({
    success: true,
    data: { slot: { id: ITEM_ID, kind: 'graphic' }, attempt },
  } as never);

const proposal = {
  id: 'attempt-0',
  attemptNumber: 0,
  videoId: null,
  graphicId: null,
};
const filled = {
  id: 'attempt-0',
  attemptNumber: 0,
  videoId: null,
  graphicId: 'graphic-1',
};

/**
 * Two cases, and the difference matters for the history.
 *
 * A PROPOSAL is attempt 0 with a null asset, written before the content existed
 * because the card that offered it needed something to stamp itself with.
 * Filling it is what makes "have I already been accepted?" answerable across a
 * remount — the question React state forgets, which handed the Accept button
 * back over a graphic that had already been made and spent a second render.
 *
 * Appending instead would leave an empty attempt 0 forever and report the first
 * version of the content as its second.
 */
describe('attachContentAsset', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('FILLS a proposal rather than appending beside it', async () => {
    loadedAttempt(proposal);
    const append = vi.spyOn(recordAttemptModule, 'recordAttempt');
    const { db, updates } = createMockDb();

    const result = await attachContentAsset(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      graphicId: 'graphic-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filledProposal).toBe(true);
      // Attempt 0 — the first version of this content IS its first version.
      expect(result.data.attemptNumber).toBe(0);
    }
    expect(updates).toContainEqual(
      expect.objectContaining({ graphicId: 'graphic-1' })
    );
    expect(append).not.toHaveBeenCalled();
  });

  it('APPENDS when the item already has content', async () => {
    loadedAttempt(filled);
    const append = vi
      .spyOn(recordAttemptModule, 'recordAttempt')
      .mockResolvedValue({
        success: true,
        data: { attemptNumber: 1 },
      } as never);
    const { db, updates } = createMockDb();

    const result = await attachContentAsset(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      graphicId: 'graphic-2',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filledProposal).toBe(false);
      expect(result.data.attemptNumber).toBe(1);
    }
    expect(append).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ itemId: ITEM_ID, graphicId: 'graphic-2' })
    );
    // The existing cut is untouched — appending must not overwrite it.
    expect(updates).toHaveLength(0);
  });

  // The reason travels with the cut, or a re-roll is indistinguishable from a
  // fresh generate when anyone looks back at it.
  it('records why, when a reason was given', async () => {
    loadedAttempt(proposal);
    const { db, updates } = createMockDb();

    await attachContentAsset(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      graphicId: 'graphic-1',
      reason: 'less salesy',
    });

    expect(updates).toContainEqual(
      expect.objectContaining({ regenerationReason: 'less salesy' })
    );
  });

  it('refuses an attach with no asset at all', async () => {
    const { db } = createMockDb();

    const result = await attachContentAsset(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('reports a failed write rather than claiming the attach landed', async () => {
    loadedAttempt(proposal);
    const chain: Record<string, unknown> = {};
    chain.update = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
    chain.where = vi.fn(() => Promise.reject(new Error('constraint')));

    const result = await attachContentAsset(chain as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      graphicId: 'graphic-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('passes a load failure through', async () => {
    vi.spyOn(loadSlotModule, 'loadSlotForOrg').mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Item not found' },
    } as never);

    const result = await attachContentAsset(createMockDb().db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      videoId: 'video-1',
    });

    expect(result.success).toBe(false);
  });
});
