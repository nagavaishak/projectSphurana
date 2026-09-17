import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type PatchVideoDraftConfigInput,
  buildPatchVideoDraftConfigPayload,
} from './patch-video-draft-config.payload';

export type { PatchVideoDraftConfigInput };

/**
 * Patches a video draft's `draftConfig` (currently the b-roll clip selection)
 * via `PATCH /videos/:id/draft-config`. The body is a partial patch deep-merged
 * server-side. Used by the assistant's video-draft-preview card, which updates
 * the local selection optimistically and fires this in the background.
 */
export const usePatchVideoDraftConfig = (options?: {
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Callers pass the shared intent; the one builder assembles the body.
    mutationFn: (input: PatchVideoDraftConfigInput) =>
      apiClient.patch(
        `videos/${input.videoId}/draft-config`,
        buildPatchVideoDraftConfigPayload(input)
      ),
    onSuccess: (_data, variables) => {
      // `useGetVideo` keys ['video', id] — SINGULAR. Invalidating only
      // ['videos', id] refreshed nothing, so the draft card kept rendering the
      // pre-patch clip selection until its poll came round. Invalidate the
      // single-video read AND the list.
      queryClient.invalidateQueries({
        queryKey: ['video', variables.videoId],
      });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    patchDraftConfig: mutation.mutate,
    patchDraftConfigAsync: mutation.mutateAsync,
    isPatching: mutation.isPending,
  };
};
