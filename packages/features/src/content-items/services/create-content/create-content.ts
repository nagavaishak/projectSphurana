import type { Graphic, Video } from '@borradh-workspace/database';
import {
  type ResultShape,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateVideoFromRequestInput,
  createVideoFromRequest,
} from '../../../videos/index.js';
import { attachContentAsset } from '../attach-content-asset/index.js';
import {
  type CreateContentGraphicInput,
  createContentGraphic,
} from '../create-content-graphic/index.js';
import { insertSlotWithFirstAttempt } from '../insert-slot/index.js';

/** Shared by both kinds — the bookkeeping half of the call. */
interface CreateContentCommon {
  /** Which surface asked. Defaults to the chat, which is the common caller. */
  source?: 'claire_chat' | 'content_studio';
  /**
   * An item opened BEFORE the content existed — a proposal the owner was shown
   * and has now accepted. Fills its attempt 0 rather than opening a second item
   * for the same piece of content. Absent on every other caller.
   */
  itemId?: string;
}

/**
 * `imageKind`, not `kind`, because `kind` is taken.
 *
 * The graphic request already spends the word on single-vs-carousel, so
 * intersecting it with the `kind: 'graphic'` discriminant collapses the member
 * to `never` — and TypeScript reports that as "these types have no overlap" on
 * the `if` two screens away, not on the type. Renaming here costs one mapping
 * line below and keeps the discriminant the same word `reviseContent` uses.
 */
type CreateGraphicMember = Omit<
  CreateContentGraphicInput,
  'source' | 'itemId' | 'kind'
> & { imageKind?: CreateContentGraphicInput['kind'] };

export type CreateContentInput =
  | ({ kind: 'video' } & CreateVideoFromRequestInput & CreateContentCommon)
  | ({ kind: 'graphic' } & CreateGraphicMember & CreateContentCommon);

interface CreateContentBase {
  /** Null when the item could not be opened — see below. */
  itemId: string | null;
  /**
   * Which cut this is. 0 on a fresh item or a filled proposal. Null alongside a
   * null `itemId`.
   *
   * The card the owner is shown stamps itself with this, so a card from an
   * earlier turn can tell that it has been superseded instead of offering to
   * approve an edit staged long after it was drawn.
   */
  attemptNumber: number | null;
  /**
   * The attempt row itself. A card in the transcript STAMPS itself with this so
   * it can tell, on a later mount, that the item has moved past it.
   *
   * Without it every card for an item is equally live: render the video, reload
   * the page, and the original proposal is still offering Accept over a cut
   * that no longer exists.
   *
   * Null when the asset was attached to an existing proposal rather than
   * opening a fresh attempt — `attachContentAsset` reports the NUMBER, not the
   * id, and the graphic paths that use it render a different card.
   */
  attemptId: string | null;
}

/**
 * A UNION, for the reason `ReviseContentOutput` is one: a caller that passed
 * `kind: 'video'` should not have to check whether it got a graphic back, and
 * reading `.graphic` off a video result should be a compile error rather than
 * an undefined at runtime.
 */
export type CreateContentOutput =
  | (CreateContentBase & { kind: 'video'; video: Video })
  | (CreateContentBase & { kind: 'graphic'; graphic: Graphic });

/**
 * Make a piece of content, and open the item that owns it.
 *
 * The counterpart to `reviseContent`, and the same argument for existing. Both
 * kinds run the identical skeleton —
 *
 *   1. produce the asset
 *   2. fill the proposal it was promised against, or open a fresh item
 *
 * — and that skeleton was previously written out once per kind, in two tools on
 * the other side of the wire. Every bug in this area has been the same shape: a
 * rule applied to one kind and not its twin, with nothing to make the omission
 * visible. `createDraftVideo` opened an item; `createGraphic` opened a proposal
 * but only outside WhatsApp; `createAdGraphic` opened nothing at all, so an ad
 * creative had no lineage and no way to be edited afterwards.
 *
 * ITEM FAILURE DOES NOT FAIL THE CONTENT. The asset row exists and its render
 * is queued by the time the item is touched. Returning an error would tell the
 * owner their content was not created while it demonstrably was, and would
 * strand a render nothing is waiting on. The item is bookkeeping; the asset is
 * the thing they asked for. A null `itemId` is the honest report, and the
 * failure is logged rather than swallowed.
 */
const createContentImpl = async (
  db: DbConnection,
  input: CreateContentInput
): Promise<Result<CreateContentOutput>> => {
  const { source = 'claire_chat', itemId } = input;

  if (input.kind === 'graphic') {
    // Already the correct shape — delegated whole rather than reimplemented, so
    // there is exactly one graphic-create path and not a second one here.
    const { kind: _kind, imageKind, ...graphicInput } = input;
    const created = await createContentGraphic(db, {
      ...graphicInput,
      ...(imageKind ? { kind: imageKind } : {}),
      source,
      ...(itemId ? { itemId } : {}),
    });
    if (!created.success) {
      return err(
        new FeatureError(
          created.error.code,
          created.error.message,
          created.error.details
        )
      );
    }
    return ok({
      kind: 'graphic',
      graphic: created.data.graphic,
      itemId: created.data.itemId,
      attemptNumber: created.data.attemptNumber,
      attemptId: null,
    });
  }

  const {
    kind: _kind,
    source: _source,
    itemId: _itemId,
    ...videoInput
  } = input;

  const created = await createVideoFromRequest(db, videoInput);
  if (!created.success) {
    return err(
      new FeatureError(
        created.error.code,
        created.error.message,
        created.error.details
      )
    );
  }
  const video = created.data;

  if (itemId) {
    const attached = await attachContentAsset(db, {
      itemId,
      organizationId: input.organizationId,
      videoId: video.id,
    });
    if (attached.success)
      return ok({
        kind: 'video',
        video,
        itemId,
        attemptNumber: attached.data.attemptNumber,
        attemptId: null,
      });
    logError('contentItems.createContent.attach', attached.error, {
      feature: 'content-items',
      extra: { itemId, videoId: video.id },
    });
    // Fall through and open one, rather than losing the lineage entirely.
  }

  try {
    const { slotId, attemptId } = await insertSlotWithFirstAttempt(db, {
      organizationId: input.organizationId,
      batchId: null,
      source,
      kind: 'video',
      position: null,
      videoId: video.id,
    });
    return ok({
      kind: 'video',
      video,
      itemId: slotId,
      attemptNumber: 0,
      attemptId,
    });
  } catch (error) {
    logError('contentItems.createContent.openItem', error, {
      feature: 'content-items',
      extra: { videoId: video.id, organizationId: input.organizationId },
    });
    return ok({
      kind: 'video',
      video,
      itemId: null,
      attemptNumber: null,
      attemptId: null,
    });
  }
};

/**
 * OVERLOADED so the output correlates with the input.
 *
 * Without these, a caller that passed `kind: 'video'` still gets the whole
 * output union back and has to re-check a question it just answered — and
 * `result.data.video` is a compile error on the branch that obviously has one.
 * TypeScript will not correlate an input union with an output union on its own.
 */
export function createContent(
  db: DbConnection,
  input: { kind: 'video' } & CreateVideoFromRequestInput & CreateContentCommon
): Promise<ResultShape<CreateContentBase & { kind: 'video'; video: Video }>>;
export function createContent(
  db: DbConnection,
  input: { kind: 'graphic' } & CreateGraphicMember & CreateContentCommon
): Promise<
  ResultShape<CreateContentBase & { kind: 'graphic'; graphic: Graphic }>
>;
export function createContent(
  db: DbConnection,
  input: CreateContentInput
): Promise<ResultShape<CreateContentOutput>>;
export function createContent(
  db: DbConnection,
  input: CreateContentInput
): Promise<ResultShape<CreateContentOutput>> {
  return trackedResult(
    'contentItems.createContent',
    () => createContentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
        serviceId: input.serviceId,
        source: input.source ?? 'claire_chat',
      },
    }
  );
}
