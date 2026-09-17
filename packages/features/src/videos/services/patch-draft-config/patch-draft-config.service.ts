import { randomUUID } from 'node:crypto';
import {
  type BRollClipConfig,
  type Video,
  type VideoDraftConfig,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { describeIneffectivePatch } from '../../template-content-keys.js';
import {
  type ClipOperation,
  type ClipOperationFailure,
  applyClipOperations,
} from '../../video-capabilities.js';
import type { PartialDraftConfig } from '../create-video/create-video.schema.js';
import {
  failedBrollClipsMessage,
  pendingBrollClipsMessage,
  queueVideoExport,
} from '../queue-video-export/queue-video-export.service.js';
import {
  type PatchDraftConfigInput,
  type PatchDraftConfigParsed,
  patchDraftConfigSchema,
} from './patch-draft-config.schema.js';

/**
 * Deep-merge a partial draft config onto an existing one. Lifted from
 * `update-video.service.ts` so the W3 patch path doesn't bounce through the
 * generic update endpoint (which also lets callers patch unrelated columns
 * like `blobUrl` / `thumbnailUrl` / `status` we don't want exposed).
 *
 * Null handling matches update-video:
 *   - `undefined` → skip (keep existing)
 *   - `null` → clear (set to undefined)
 *   - any value → replace; nested plain objects get shallow-merged
 */
function deepMergeDraftConfig(
  existing: VideoDraftConfig,
  partial: PartialDraftConfig
): VideoDraftConfig {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    const k = key as keyof VideoDraftConfig;

    if (value === null) {
      (merged as Record<string, unknown>)[k] = undefined;
      continue;
    }

    const existingVal = existing[k];

    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existingVal !== null &&
      existingVal !== undefined &&
      typeof existingVal === 'object' &&
      !Array.isArray(existingVal)
    ) {
      (merged as Record<string, unknown>)[k] = {
        ...existingVal,
        ...value,
      };
    } else {
      (merged as Record<string, unknown>)[k] = value;
    }
  }

  return merged;
}

/**
 * Map an operation failure to the error a caller can act on.
 *
 * These are USER errors, not internal ones — "there is no fourth clip" is a
 * correctable request, and reporting it as a 500 would send Claire into a retry
 * loop against a draft that is fine.
 */
function operationError(failure: ClipOperationFailure): FeatureError {
  switch (failure.reason) {
    case 'index_out_of_range':
      return new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `There is no clip at position ${failure.index}.`,
        { index: failure.index }
      );
    case 'asset_not_in_clips':
      return new FeatureError(
        ErrorCodes.NOT_FOUND,
        'That clip is not in this video.',
        { assetId: failure.assetId }
      );
    case 'address_not_named':
      return new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Name the clip by exactly one of `index` or `targetAssetId`.'
      );
    default:
      return new FeatureError(
        ErrorCodes.INVALID_STATE,
        'A video needs at least one clip — swap this one instead of removing it.'
      );
  }
}

/**
 * Widen the request-shaped operations to the domain ones.
 *
 * Only `replace-all` needs translating: it arrives as bare asset ids and the
 * domain wants clip configs. Each id is matched back to the STORED entry it
 * came from so `clipType` and a resolved `url` ride along — a before/after
 * video whose clips came back as `{assetId, order}` alone would render as
 * three anonymous b-rolls, having lost which one was the "before".
 *
 * Matching consumes each stored entry once, so a list that legitimately
 * repeats an asset keeps both of its configs rather than cloning the first.
 * Ids with no stored entry are new footage the owner just added.
 *
 * Resolved against the list as it was BEFORE this batch of operations. The card
 * sends exactly one `replace-all` and nothing else, so there is no earlier
 * operation for it to be out of step with; anything that did combine them is
 * asking for two different vocabularies to describe one list.
 */
function toDomainClipOperations(
  stored: readonly BRollClipConfig[],
  operations: NonNullable<PatchDraftConfigParsed['clipOperations']>
): ClipOperation[] {
  return operations.map((operation) => {
    if (operation.op !== 'replace-all') return operation;

    const unused = [...stored];
    return {
      op: 'replace-all' as const,
      clips: operation.assetIds.map((assetId, order) => {
        const at = unused.findIndex((clip) => clip.assetId === assetId);
        if (at === -1) return { assetId, order };
        const [previous] = unused.splice(at, 1);
        return { ...previous, order };
      }),
    };
  });
}

export interface PatchDraftConfigOutput {
  video: Video;
  /** True when a fresh render job was queued by this patch. */
  rendered: boolean;
  /**
   * Set when the patch FORKED rather than overwrote — `video` is then a new
   * row and this is the id of the one it was cut from, still intact.
   */
  forkedFromVideoId?: string;
  /** Why the edit was saved without queueing a render, when applicable. */
  renderMessage?: string;
}

const patchDraftConfigImpl = async (
  db: DbConnection,
  input: PatchDraftConfigInput
): Promise<Result<PatchDraftConfigOutput>> => {
  const parsed = patchDraftConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    videoId,
    organizationId,
    patch,
    clipOperations,
    title,
    requeueRender,
    whatsappDelivery,
    preserveRendered,
  } = parsed.data;

  // Load the existing row + verify ownership in one shot.
  const [existing] = await db
    .select()
    .from(video)
    .where(
      and(
        eq(video.id, videoId),
        eq(video.organizationId, organizationId),
        notDeleted(video)
      )
    )
    .limit(1);

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
  }

  if (!existing.draftConfig) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Video has no draft configuration to patch. Re-create the draft first.'
      )
    );
  }

  // Named clip edits run FIRST, against the stored list — which is the whole
  // point: the caller never has to hold the array, so it cannot lose the parts
  // of it it could not see. The declarative patch then merges on top, so an
  // explicit `patch.bRollClips` still wins as a deliberate wholesale replace.
  let configToMerge: VideoDraftConfig = existing.draftConfig;
  if (clipOperations && clipOperations.length > 0) {
    const stored = existing.draftConfig.bRollClips ?? [];
    const applied = applyClipOperations(
      stored,
      toDomainClipOperations(stored, clipOperations)
    );
    if (!applied.ok) {
      return err(operationError(applied.failure));
    }
    configToMerge = { ...existing.draftConfig, bRollClips: applied.clips };
  }

  const mergedConfig = deepMergeDraftConfig(configToMerge, patch);

  // Renders are non-resumable; if the existing video was already rendering,
  // patching mid-render is a footgun. Force the caller to wait or to reset
  // the row to `draft` before patching.
  if (existing.status === 'queued' || existing.status === 'processing') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        `Video is currently ${existing.status}. Wait for the render to finish before patching, or use update-video to reset the status.`
      )
    );
  }

  // ── Refuse a patch this video's template will not read ─────────────────
  //
  // `draftConfig` is flat and template-agnostic, so writing a key the active
  // template ignores is accepted, persisted, and renders identically. Nothing
  // is "wrong": the write succeeded and the renderer honestly reproduced a
  // config whose meaningful half never moved. That is how a real edit was lost
  // — `scriptText` patched onto a `myth-fact` video, which renders from
  // `mythFact.pairs` and only reads `scriptText` for AI voiceover.
  //
  // Only the total case is refused. A patch that changes something real AND
  // carries an inert key is fine: the caller got what they asked for, and a
  // client on older code sending a field this template dropped should degrade
  // rather than 400.
  const ineffective = describeIneffectivePatch({
    variationId: existing.variationId,
    narrationType: existing.draftConfig.narrationType,
    patchKeys: Object.keys(patch),
  });
  if (ineffective) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        ineffective.suggestedKey
          ? `This video renders from "${ineffective.suggestedKey}" — ${ineffective.ignoredKeys.join(', ')} ${ineffective.ignoredKeys.length === 1 ? 'is' : 'are'} not read by its template, so this edit would change nothing. Patch "${ineffective.suggestedKey}" instead.`
          : `${ineffective.ignoredKeys.join(', ')} ${ineffective.ignoredKeys.length === 1 ? 'is' : 'are'} not read by this video's template, so this edit would change nothing.`,
        {
          ignoredKeys: ineffective.ignoredKeys,
          ...(ineffective.suggestedKey
            ? { suggestedKey: ineffective.suggestedKey }
            : {}),
        }
      )
    );
  }

  const changesAnything =
    Object.keys(patch).length > 0 ||
    (clipOperations?.length ?? 0) > 0 ||
    title !== undefined;

  // ── Copy-on-write, when there is a finished cut to protect ─────────────
  //
  // `blobUrl` and not `status`: a patch resets status to 'draft' while leaving
  // the previous render's URL in place, so status says "draft" about a video
  // the owner has already watched.
  //
  // A no-op patch does NOT fork. Cloning a video row and spending a render to
  // reproduce the same frames is worse than doing nothing, and it would make
  // the attempt history read as though the owner asked for changes they never
  // got. (A patch naming a field that is not part of the draft config parses
  // to `{}` here — that is a separate, live bug, but forking on it would turn a
  // silent no-op into a silent no-op that also costs a render.)
  if (preserveRendered && existing.blobUrl && changesAnything) {
    const forkId = randomUUID();
    let forked: Video;
    try {
      const [row] = await db
        .insert(video)
        .values({
          id: forkId,
          organizationId: existing.organizationId,
          createdById: existing.createdById,
          title: title ?? existing.title,
          draftConfig: mergedConfig,
          schemaVersion: existing.schemaVersion,
          usageType: existing.usageType,
          serviceId: existing.serviceId,
          offerId: existing.offerId,
          templateId: existing.templateId,
          variationId: existing.variationId,
          // Carried so the fork re-renders the same way the original did — a
          // fresh seed would re-roll clip choices and timings the owner never
          // asked to change.
          synthesisSeed: existing.synthesisSeed,
          status: 'draft',
          progress: 0,
          // Deliberately NOT carried: they describe the PREVIOUS render, and a
          // fork that inherits them claims to be a finished video it has not
          // produced yet.
          blobUrl: null,
          thumbnailUrl: null,
          durationMs: null,
          exportedAt: null,
        })
        .returning();
      forked = row;
    } catch (error) {
      logError('videos.patchDraftConfig.fork', error, {
        feature: 'videos',
        extra: { videoId, organizationId },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to save this edit as a new version'
        )
      );
    }

    if (!requeueRender) {
      return ok({ video: forked, rendered: false, forkedFromVideoId: videoId });
    }

    const queued = await queueVideoExport(db, {
      id: forkId,
      whatsappDelivery,
    });
    if (!queued.success) {
      if (
        queued.error.code === ErrorCodes.INVALID_STATE &&
        (queued.error.message === pendingBrollClipsMessage ||
          queued.error.message === failedBrollClipsMessage)
      ) {
        return ok({
          video: forked,
          rendered: false,
          forkedFromVideoId: videoId,
          renderMessage:
            queued.error.message === pendingBrollClipsMessage
              ? 'Your changes were saved as a new version. Some selected footage is still processing, so render it once the clips are ready.'
              : 'Your changes were saved as a new version. Some selected footage could not be prepared, so replace or re-upload it before rendering.',
        });
      }
      return err(
        new FeatureError(
          queued.error.code,
          `Edit saved as a new version but rendering it failed: ${queued.error.message}`,
          { videoId: forkId }
        )
      );
    }

    return ok({
      video: queued.data,
      rendered: true,
      forkedFromVideoId: videoId,
    });
  }

  // Build the update set. We always overwrite draftConfig with the merged
  // shape; title is optional. Any config change invalidates a previous
  // export, even when the caller deliberately defers queueing it (the clip
  // picker does this so an X click can never be blocked by a pending clip).
  // A title-only change with `requeueRender: false` intentionally preserves
  // the rendered state.
  const updateSet: Partial<typeof video.$inferInsert> = {
    draftConfig: mergedConfig,
  };
  if (title !== undefined) updateSet.title = title;
  // A clip edit changes the config just as much as a patch key does, so it has
  // to invalidate a previous export too — otherwise swapping a clip with
  // `requeueRender: false` leaves the row claiming a rendered video that no
  // longer matches its config.
  const changesDraftConfig =
    Object.keys(patch).length > 0 || (clipOperations?.length ?? 0) > 0;
  if (requeueRender || changesDraftConfig) {
    updateSet.status = 'draft';
    updateSet.progress = 0;
    updateSet.errorMessage = null;
  }

  let updated: Video;
  try {
    const [row] = await db
      .update(video)
      .set(updateSet)
      .where(and(eq(video.id, videoId), notDeleted(video)))
      .returning();

    if (!row) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
    }
    updated = row;
  } catch (error) {
    logError('videos.patchDraftConfig', error, {
      feature: 'videos',
      extra: { videoId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to patch draft config'
      )
    );
  }

  // Re-queue the render. This delegates to queueVideoExport which validates
  // draftConfig completeness + asset transcode status — if the patch left
  // the config invalid we surface that here rather than rendering garbage.
  let rendered = false;
  if (requeueRender) {
    const queueResult = await queueVideoExport(db, {
      id: videoId,
      whatsappDelivery,
    });
    if (!queueResult.success) {
      // A pending transcode is an expected, recoverable state. The config has
      // already been saved above, so reporting the patch itself as failed
      // makes the UI roll back an edit that actually persisted. Keep the
      // video in draft and tell Claire/the UI that rendering is deferred.
      if (
        queueResult.error.code === ErrorCodes.INVALID_STATE &&
        (queueResult.error.message === pendingBrollClipsMessage ||
          queueResult.error.message === failedBrollClipsMessage)
      ) {
        return ok({
          video: updated,
          rendered: false,
          renderMessage:
            queueResult.error.message === pendingBrollClipsMessage
              ? 'Your changes were saved. Some selected footage is still processing, so render it once the clips are ready.'
              : 'Your changes were saved. Some selected footage could not be prepared, so replace or re-upload it before rendering.',
        });
      }

      return err(
        new FeatureError(
          queueResult.error.code,
          `Patch applied but re-render failed: ${queueResult.error.message}`,
          { videoId }
        )
      );
    }
    rendered = true;
    // queueVideoExport already flipped status → queued + bumped progress; we
    // return the latest row so callers don't have to re-fetch.
    return ok({ video: queueResult.data, rendered });
  }

  return ok({ video: updated, rendered });
};

export const patchDraftConfig = (
  db: DbConnection,
  input: PatchDraftConfigInput
) =>
  trackedResult(
    'videos.patchDraftConfig',
    () => withOrgScope((tx) => patchDraftConfigImpl(tx, input), { db }),
    { properties: { videoId: input.videoId } }
  );

export type PatchDraftConfigResult = Awaited<
  ReturnType<typeof patchDraftConfig>
>;
