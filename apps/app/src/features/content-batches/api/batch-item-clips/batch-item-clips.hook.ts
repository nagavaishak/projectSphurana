import { apiClient } from '@borradh-workspace/api-client';
import type {
  ApplyVideoEditsResponse,
  BatchItemClipsResponse,
  DiscardVideoEditsResponse,
  StageItemClipsResponse,
} from '@borradh-workspace/api-client/types';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

/**
 * The clips behind one video post, with any staged edit marked.
 *
 * Server-sourced from `draftConfig.bRollClips`. An earlier version of the
 * filmstrip read the editor's `video_draft_clip` tray, which batch videos never
 * populate — so it rendered "no clips yet" over every post in the batch while
 * the video plainly had three.
 */
export const batchItemClipsQueryOptions = (itemId: string) =>
  queryOptions({
    queryKey: queryKeys.contentBatches.itemClips(itemId),
    queryFn: () =>
      apiClient.get<BatchItemClipsResponse>(
        `content-batches/items/${itemId}/clips`
      ),
    enabled: !!itemId,
    staleTime: 30 * 1000,
  });

export const useBatchItemClips = (itemId: string) => {
  const query = useQuery(batchItemClipsQueryOptions(itemId));
  const clips = query.data?.clips ?? [];
  const textChanges = query.data?.textChanges ?? [];
  const pendingRelist = query.data?.pendingRelist ?? false;

  return {
    clips,
    textChanges,
    /** True when `clips` is the list the owner staged, not the one that rendered. */
    pendingRelist,
    hasStagedEdits: query.data?.hasStagedEdits ?? false,
    /**
     * How many changes Accept is about to commit — clips marked for removal or
     * swap, plus any on-screen text change. Derived here so the surfaces that
     * report it don't each re-derive it, and so "1 change" can never disagree
     * with `hasStagedEdits`.
     *
     * A staged RELIST is ONE change however many clips moved: the owner
     * rearranged a list, they did not issue one instruction per position.
     */
    stagedCount:
      (pendingRelist ? 1 : clips.filter((clip) => clip.staged).length) +
      textChanges.length,
    renderCount: query.data?.renderCount ?? 0,
    /** The cut this list describes — a card compares it to the one it was born on. */
    attemptId: query.data?.attemptId,
    isLoading: query.isLoading,
  };
};

/**
 * Stage the clip list the owner arranged. Renders nothing.
 *
 * A server write rather than component state, and the whole design turns on it:
 * an edit held in the browser is invisible to Claire, so "now render it" acts
 * on the list she last knew about rather than the one the owner just built.
 * Staged on the item, the edit is in her context by construction and survives
 * a refresh.
 *
 * Sends the WHOLE list, in order — not a diff. That is the only shape that can
 * say "these three, in this order", and deriving a diff here would be the
 * client guessing at an intention the list already states.
 */
export const useStageItemClips = (options?: {
  onSuccess?: (result: StageItemClipsResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      itemId,
      assetIds,
    }: { itemId: string; assetIds: string[] }) =>
      apiClient.post<StageItemClipsResponse>(
        `content-batches/items/${itemId}/stage-clips`,
        { assetIds }
      ),
    onSuccess: (result, { itemId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.itemClips(itemId),
      });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save that clip order');
    },
  });

  return {
    stageClips: mutation.mutate,
    stageClipsAsync: mutation.mutateAsync,
    isStaging: mutation.isPending,
  };
};

/**
 * Throw away everything staged against this post — the card's Reject.
 *
 * The other half of the approval: approving renders, so rejecting has to leave
 * nothing behind, or the next Accept would commit a change the owner declined.
 */
export const useDiscardVideoEdits = (options?: {
  onSuccess?: (result: DiscardVideoEditsResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (itemId: string) =>
      apiClient.delete<DiscardVideoEditsResponse>(
        `content-batches/items/${itemId}/staged-edits`
      ),
    onSuccess: (result, itemId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.itemClips(itemId),
      });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to discard those changes');
    },
  });

  return {
    discardVideoEdits: mutation.mutate,
    isDiscarding: mutation.isPending,
  };
};

/**
 * Commit every staged edit on this post — one render for however many
 * instructions produced them.
 *
 * Invalidates the batch so the preview starts polling the new render, and the
 * clip list so the staged markers clear.
 */
export const useApplyVideoEdits = (options?: {
  onSuccess?: (result: ApplyVideoEditsResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (itemId: string) =>
      apiClient.post<ApplyVideoEditsResponse>(
        `content-batches/items/${itemId}/apply-edits`,
        {}
      ),
    onSuccess: (result, itemId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.itemClips(itemId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.all(),
      });
      if (result.applied) {
        toast.success("Re-rendering — it'll take a minute or two");
      }
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to apply those changes');
      options?.onError?.(error);
    },
  });

  return {
    applyVideoEdits: mutation.mutate,
    isApplying: mutation.isPending,
  };
};
