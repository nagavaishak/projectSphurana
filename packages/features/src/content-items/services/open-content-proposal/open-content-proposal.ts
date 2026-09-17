import type { ContentItemSource } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { insertSlotWithFirstAttempt } from '../insert-slot/index.js';

export interface OpenContentProposalInput {
  organizationId: string;
  kind: 'video' | 'graphic';
  source: ContentItemSource;
  caption?: string | null;
}

export interface OpenContentProposalOutput {
  itemId: string;
  attemptId: string;
}

/**
 * Open an item for content that has been PROPOSED but not yet made.
 *
 * Attempt 0 carries a null asset, which `insertSlotWithFirstAttempt` already
 * permits. That null IS the state: "the owner has been shown a proposal and
 * has not acted on it yet."
 *
 * WHY A ROW EXISTS BEFORE THE CONTENT DOES
 * ----------------------------------------
 * The card that proposes a graphic held its own spent state in React. A
 * remount — a panel opening, a reload, coming back to the conversation — gave
 * it back its Accept button, over a proposal the owner had already accepted.
 * Pressing it again does not re-approve anything; it GENERATES A SECOND
 * GRAPHIC and spends a second render.
 *
 * The video card does not have this problem because a video exists before its
 * card does, so the card can stamp itself with the cut it belongs to and retire
 * when the item moves past it. A graphic proposal had nothing to stamp — no
 * asset, no attempt, no row. This gives it one.
 *
 * THE COST, stated plainly: a proposal the owner rejects or ignores leaves an
 * item row behind for content that never existed. That is the accepted trade —
 * a spare row is cheap, and a duplicate render is not.
 */
const openContentProposalImpl = async (
  db: DbConnection,
  input: OpenContentProposalInput
): Promise<Result<OpenContentProposalOutput>> => {
  try {
    const { slotId, attemptId } = await insertSlotWithFirstAttempt(db, {
      organizationId: input.organizationId,
      // Standalone by construction — a proposal made in conversation belongs to
      // no plan, so there is no position to hold either.
      batchId: null,
      source: input.source,
      kind: input.kind,
      position: null,
      // The point of the whole thing.
      videoId: null,
      graphicId: null,
      caption: input.caption ?? null,
    });

    return ok({ itemId: slotId, attemptId });
  } catch (error) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to open an item for this proposal',
        { kind: input.kind },
        error instanceof Error ? error : undefined
      )
    );
  }
};

export const openContentProposal = (
  db: DbConnection,
  input: OpenContentProposalInput
) =>
  trackedResult(
    'contentItems.openContentProposal',
    () => openContentProposalImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
      },
    }
  );
