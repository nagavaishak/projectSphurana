import type { Graphic } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type GenerateGraphicFromServiceInput,
  generateGraphicFromService,
} from '../../../graphics/index.js';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { attachContentAsset } from '../attach-content-asset/index.js';
import { insertSlotWithFirstAttempt } from '../insert-slot/index.js';

export interface CreateContentGraphicInput
  extends GenerateGraphicFromServiceInput {
  /** Which surface asked. Defaults to the chat, which is the common caller. */
  source?: 'claire_chat' | 'content_studio';
  /**
   * An item opened for this content BEFORE it was made — a proposal the owner
   * was shown and has now accepted. Fills its attempt 0 instead of opening a
   * second item for the same graphic. Absent on every other caller.
   */
  itemId?: string;
}

export interface CreateContentGraphicOutput {
  graphic: Graphic;
  /** Null when the item could not be opened — see below. */
  itemId: string | null;
  /**
   * Which cut this is. 0 on a fresh item or a filled proposal; higher when the
   * asset was appended to an item that already had content. Null alongside a
   * null `itemId`.
   *
   * A card in the transcript is a historical object reading live state, so it
   * needs to know WHICH cut it was drawn for — otherwise every card for an item
   * is equally live, and an old one offers to approve an edit staged long after
   * it was written.
   */
  attemptNumber: number | null;
}

/**
 * Create a standalone graphic AND open the content item that owns it.
 *
 * The counterpart to `reviseContentGraphic`. Opening the item here rather than
 * at first edit means attempt 0 is a genuine record of what was generated,
 * instead of the reconstruction `ensureItemForAsset` has to settle for when it
 * adopts something older. Adoption stays as the fallback for everything that
 * predates this.
 *
 * The batch planner and the onboarding ad-picker call
 * `generateGraphicFromService` directly and are unaffected: the planner opens
 * its own slot with a batch and a position, and onboarding tiles are not
 * content items at all.
 *
 * ITEM FAILURE DOES NOT FAIL THE GRAPHIC. The graphic row exists and its render
 * is queued by the time we get here. Returning an error would tell the owner
 * their graphic was not created while it demonstrably was, and would strand a
 * render nothing is waiting on. The item is bookkeeping; the graphic is the
 * thing they asked for. A null `itemId` is the honest report, and the failure
 * is logged rather than swallowed.
 */
const createContentGraphicImpl = async (
  db: DbConnection,
  input: CreateContentGraphicInput
): Promise<Result<CreateContentGraphicOutput>> => {
  const { source = 'claire_chat', itemId, ...generateInput } = input;

  const generated = await generateGraphicFromService(db, generateInput);
  if (!generated.success) {
    return err(
      new FeatureError(
        generated.error.code,
        generated.error.message,
        generated.error.details
      )
    );
  }

  // An item was opened BEFORE the graphic existed — the card that proposed it
  // needed something to stamp itself with. Fill that proposal rather than
  // opening a second item for the same piece of content.
  if (itemId) {
    const attached = await attachContentAsset(db, {
      itemId,
      organizationId: input.organizationId,
      graphicId: generated.data.id,
    });
    if (attached.success) {
      return ok({
        graphic: generated.data,
        itemId,
        attemptNumber: attached.data.attemptNumber,
      });
    }
    logError('contentItems.createContentGraphic.attach', attached.error, {
      feature: 'content-items',
      extra: { itemId, graphicId: generated.data.id },
    });
    // Fall through and open one, rather than losing the lineage entirely.
  }

  try {
    const { slotId } = await insertSlotWithFirstAttempt(db, {
      organizationId: input.organizationId,
      batchId: null,
      source,
      kind: 'graphic',
      position: null,
      graphicId: generated.data.id,
    });
    return ok({ graphic: generated.data, itemId: slotId, attemptNumber: 0 });
  } catch (error) {
    logError('contentItems.createContentGraphic.openItem', error, {
      feature: 'content-items',
      extra: {
        graphicId: generated.data.id,
        organizationId: input.organizationId,
      },
    });
    return ok({ graphic: generated.data, itemId: null, attemptNumber: null });
  }
};

export const createContentGraphic = (
  db: DbConnection,
  input: CreateContentGraphicInput
) =>
  trackedResult(
    'contentItems.createContentGraphic',
    () => createContentGraphicImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
        source: input.source ?? 'claire_chat',
      },
    }
  );
