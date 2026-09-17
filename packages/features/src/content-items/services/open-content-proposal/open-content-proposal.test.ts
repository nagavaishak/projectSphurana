import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// Spy the SOURCE module, not the barrel: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import * as insertSlotModule from '../insert-slot/insert-slot.js';
import { openContentProposal } from './open-content-proposal.js';

const ORG_ID = 'org-1';
const db = {} as never;

/**
 * A row that exists before the content does.
 *
 * The card proposing a graphic held its own spent state in React, and a remount
 * — a panel opening, a reload, coming back to the conversation — gave it back
 * its Accept button over a proposal the owner had already accepted. Pressing it
 * again does not re-approve anything: it generates a SECOND graphic and spends
 * a second render.
 *
 * Attempt 0 with a NULL asset is the answer. It is a fact on a row rather than
 * a hook, so it survives everything React forgets.
 */
describe('openContentProposal', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('opens an item whose first attempt has no asset', async () => {
    const insert = vi
      .spyOn(insertSlotModule, 'insertSlotWithFirstAttempt')
      .mockResolvedValue({ slotId: 'item-1', attemptId: 'attempt-0' } as never);

    const result = await openContentProposal(db, {
      organizationId: ORG_ID,
      kind: 'graphic',
      source: 'claire_chat',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.itemId).toBe('item-1');
      // The card stamps itself with this, so a later cut retires it.
      expect(result.data.attemptId).toBe('attempt-0');
    }
    expect(insert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        kind: 'graphic',
        // No asset — that null IS the proposal.
        videoId: null,
        graphicId: null,
      })
    );
  });

  // Standalone by construction: a proposal made in conversation belongs to no
  // monthly plan, so there is no position to hold either.
  it('belongs to no batch', async () => {
    const insert = vi
      .spyOn(insertSlotModule, 'insertSlotWithFirstAttempt')
      .mockResolvedValue({ slotId: 'item-1', attemptId: 'attempt-0' } as never);

    await openContentProposal(db, {
      organizationId: ORG_ID,
      kind: 'video',
      source: 'claire_chat',
    });

    expect(insert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ batchId: null, position: null })
    );
  });

  it('reports a failure rather than returning an id that does not exist', async () => {
    vi.spyOn(insertSlotModule, 'insertSlotWithFirstAttempt').mockRejectedValue(
      new Error('constraint violation')
    );

    const result = await openContentProposal(db, {
      organizationId: ORG_ID,
      kind: 'graphic',
      source: 'claire_chat',
    });

    expect(result.success).toBe(false);
  });
});
