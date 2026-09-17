import {
  type DraftClip,
  invalidateDraftClips,
  useDraftClips,
  useUpdateDraftClips,
  useUploadClip,
} from '@/features/assistant';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Tray state hook (W-C10-clip-tray) — `videoId`-scoped composition of:
 *  - `useDraftClips` — read the persisted tray
 *  - `useUploadClip` — drop-a-clip-in-chat upload (asset-library ingest)
 *  - `useUpdateDraftClips` — drag-reorder + ✕-remove (PUT replace)
 *
 * Optimistic updates are not implemented here — `useDraftClips` is
 * `staleTime: 0` so every operator-send refresh picks up server state. A
 * future polish pass can layer in optimistic tile insertion if the upload
 * path feels laggy.
 *
 * The composer mounts `<ClipTray>` only when `videoId` is non-null. When
 * the active draft changes, the tray re-fetches against the new id.
 */
export interface UseClipTrayStateOptions {
  videoId: string | null;
}

export function useClipTrayState({ videoId }: UseClipTrayStateOptions) {
  const queryClient = useQueryClient();
  const { clips, isLoading, isError, refetch } = useDraftClips(videoId);
  const upload = useUploadClip();
  const update = useUpdateDraftClips();

  const dropClip = useCallback(
    async (file: File, beatOrder?: number) => {
      if (!videoId) {
        throw new Error('No active video draft.');
      }
      await upload.mutateAsync({ file, videoId, beatOrder });
    },
    [videoId, upload]
  );

  const removeClip = useCallback(
    async (clipId: string) => {
      if (!videoId) return;
      const remaining = clips
        .filter((c) => c.id !== clipId && c.assetId !== null)
        .map((c, idx) => ({
          assetId: c.assetId as string,
          source: c.source,
          beatOrder: idx,
          processingStatus: c.processingStatus,
        }));
      await update.mutateAsync({ videoId, clips: remaining });
    },
    [videoId, clips, update]
  );

  const reorderClips = useCallback(
    async (orderedIds: string[]) => {
      if (!videoId) return;
      const byId = new Map<string, DraftClip>();
      for (const c of clips) byId.set(c.id, c);
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((c): c is DraftClip => Boolean(c) && c?.assetId !== null)
        .map((c, idx) => ({
          assetId: c.assetId as string,
          source: c.source,
          beatOrder: idx,
          processingStatus: c.processingStatus,
        }));
      await update.mutateAsync({ videoId, clips: reordered });
    },
    [videoId, clips, update]
  );

  const refresh = useCallback(() => {
    if (!videoId) return;
    void invalidateDraftClips(queryClient, videoId);
  }, [videoId, queryClient]);

  return {
    clips,
    isLoading,
    isError,
    refetch,
    refresh,
    dropClip,
    removeClip,
    reorderClips,
    isUploading: upload.isPending,
    isUpdating: update.isPending,
  };
}
