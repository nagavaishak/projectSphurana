import { apiClient } from '@borradh-workspace/api-client';
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

/**
 * Chat-native clip tray (W-C10-clip-tray) — frontend hooks for
 * `videos/:id/draft-clips`.
 *
 * The tray is a persistent strip in the composer that lives across operator
 * sends for the lifetime of a video draft. Clips can land via three paths:
 *  - operator drag-drops a video into chat → upload + create asset + POST tray row
 *    (handled by `use-upload-clip.ts`)
 *  - `videos_autoSelectClips` runs server-side and persists `suggested` rows
 *  - operator picks an existing library asset (future surface — same POST
 *    shape with `source: 'library'`)
 *
 * Reads via `useDraftClips({ videoId })`; writes via `useUpdateDraftClips`
 * (PUT replace, used by drag-reorder + ✕-remove). The hooks invalidate
 * `['assistant','draft-clips', videoId]` on every write to keep the tray
 * in sync after the operator's next turn.
 */

export type DraftClipSource = 'uploaded' | 'library' | 'suggested';
export type DraftClipProcessingStatus =
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

export interface DraftClip {
  id: string;
  videoId: string;
  assetId: string | null;
  source: DraftClipSource;
  beatOrder: number;
  processingStatus: DraftClipProcessingStatus;
  createdAt: string;
  updatedAt: string;
  asset: {
    id: string;
    name: string;
    type: string;
    duration: number | null;
    blobUrl: string | null;
    thumbnailUrl: string | null;
    tags: string[];
  } | null;
}

export interface DraftClipsResponse {
  clips: DraftClip[];
}

export const draftClipsQueryKey = (videoId: string) =>
  ['assistant', 'draft-clips', videoId] as const;

export const draftClipsQueryOptions = (videoId: string | null) =>
  queryOptions({
    queryKey: draftClipsQueryKey(videoId ?? ''),
    queryFn: async (): Promise<DraftClipsResponse> => {
      if (!videoId) return { clips: [] };
      return apiClient.get<DraftClipsResponse>(`videos/${videoId}/draft-clips`);
    },
    enabled: !!videoId,
    // Refetch on every operator send so async ingest progress (clip flips
    // from `processing` → `ready`) shows up by the next turn — see brief
    // §"Async strategy: polling-on-send".
    staleTime: 0,
  });

export function useDraftClips(videoId: string | null) {
  const query = useQuery(draftClipsQueryOptions(videoId));
  return {
    clips: query.data?.clips ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function invalidateDraftClips(
  client: QueryClient,
  videoId: string
): Promise<void> {
  return client.invalidateQueries({ queryKey: draftClipsQueryKey(videoId) });
}

interface UpdateDraftClipsBody {
  videoId: string;
  clips: Array<{
    assetId: string;
    source: DraftClipSource;
    beatOrder: number;
    processingStatus?: DraftClipProcessingStatus;
  }>;
}

/**
 * Replace the tray for a video draft (PUT). Drag-reorder, ✕-remove, and
 * any other "the tray now looks like this" intent run through here.
 */
export function useUpdateDraftClips() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ videoId, clips }: UpdateDraftClipsBody) =>
      apiClient.put(`videos/${videoId}/draft-clips`, { clips }),
    onSuccess: (_data, { videoId }) => {
      void invalidateDraftClips(queryClient, videoId);
    },
  });
}
