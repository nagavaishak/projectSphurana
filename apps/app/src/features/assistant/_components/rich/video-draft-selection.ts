export interface DraftClipSelectionPatch {
  patch: { bRollClips: Array<{ assetId: string; order: number }> };
  requeueRender: false;
}

/** Save clip choices on the draft without bypassing Claire's render approval. */
export function buildDraftClipSelectionPatch(
  assetIds: string[]
): DraftClipSelectionPatch {
  return {
    patch: {
      bRollClips: assetIds.map((assetId, order) => ({ assetId, order })),
    },
    requeueRender: false,
  };
}

/**
 * Can the owner change this video's clips right now?
 *
 * `draft` ONLY, until copy-on-write landed. That was correct while a patch
 * merged into the stored config and re-rendered over `blobUrl`: editing a
 * finished video destroyed the cut the owner had already watched and approved,
 * so the safe answer was to refuse. The cost was that "swap the second clip" —
 * the single most common thing anyone wants — was impossible on the only videos
 * anyone has an opinion about, the rendered ones.
 *
 * `patchDraftConfig` now FORKS when a rendered cut exists: the edit becomes a
 * new video recorded as the next attempt of the item, and the original is
 * untouched. There is nothing left to protect, so the lock goes.
 *
 * `queued` / `processing` stay locked, and that is not caution — the service
 * refuses a patch mid-render outright, so offering the button would produce a
 * dialog whose confirm always fails. `failed` is editable because fixing the
 * clips is exactly how an owner recovers one.
 */
export function isDraftVideoEditable(
  status: VideoStatus | null | undefined
): boolean {
  return status === 'draft' || status === 'ready' || status === 'failed';
}

export function getOrderedDraftClipAssetIds(
  draftConfig: Pick<VideoDraftConfig, 'bRollClips'> | null | undefined
): string[] {
  return [...(draftConfig?.bRollClips ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((clip) => clip.assetId);
}
import type {
  VideoDraftConfig,
  VideoStatus,
} from '@borradh-workspace/api-client/types';
