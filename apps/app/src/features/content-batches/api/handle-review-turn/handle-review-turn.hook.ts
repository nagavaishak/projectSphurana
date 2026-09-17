import { apiClient } from '@borradh-workspace/api-client';
import type {
  HandleReviewTurnInput,
  ListBatchItemMessagesResponse,
  ReviewTurnResponse,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import { toast } from 'sonner';

interface RefineArgs {
  itemId: string;
  instruction: string;
}

type UseReviewTurnOptions = {
  onSuccess?: (result: ReviewTurnResponse) => void;
  onError?: (error: Error) => void;
};

/**
 * Ask Claire to rewrite this post's caption.
 *
 * Copy only — this never re-renders the image or video, and never spends one of
 * the item's three regenerations.
 *
 * On success the thread cache is written directly from the response rather than
 * invalidated: the server already returned the full thread, so refetching would
 * make the two turns the user just watched appear, vanish and reappear. The
 * batch query IS invalidated, because the caption on the item changed.
 */
export const useReviewTurn = (options?: UseReviewTurnOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ itemId, instruction }: RefineArgs) => {
      const body: HandleReviewTurnInput = { instruction };
      return apiClient.post<ReviewTurnResponse>(
        `content-batches/items/${itemId}/messages`,
        body
      );
    },
    onSuccess: (result, { itemId }) => {
      queryClient.setQueryData<ListBatchItemMessagesResponse>(
        queryKeys.contentBatches.itemMessages(itemId),
        { messages: result.messages }
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.all(),
      });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      // No toast: the thread renders the failure inline with a retry, so a
      // toast would be a second copy of the same news, detached from the
      // message it belongs to.
      options?.onError?.(error);
    },
  });

  return {
    refineCaption: mutation.mutate,
    refineCaptionAsync: mutation.mutateAsync,
    isRefining: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error as Error | null,
    reset: mutation.reset,
  };
};

/**
 * Set the caption directly — a hand-edit in the caption box, or a revert to an
 * earlier version from the thread. No model call and no thread entry.
 */
export const useUpdateBatchItemCaption = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ itemId, caption }: { itemId: string; caption: string }) =>
      apiClient.patch(`content-batches/items/${itemId}/caption`, { caption }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.all(),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save the caption');
    },
  });

  return {
    updateCaption: mutation.mutate,
    updateCaptionAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
