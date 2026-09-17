import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type RegenerateBatchItemResponse,
  regenerateBatchItemResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  PendingRegenerateEdit,
  RegenerateBatchItemInput,
} from '../../types';

type UseRegenerateBatchItemOptions = {
  onSuccess?: (result: RegenerateBatchItemResponse) => void;
  onError?: (error: Error) => void;
};

interface RegenerateArgs {
  itemId: string;
  reason?: string;
  /** For carousel graphics: 0-based slide to refine (omit = whole asset). */
  slideIndex?: number;
  /**
   * A per-slide instruction list — what the review thread proposes and the
   * owner confirms. Supersedes `reason`/`slideIndex`, which is what the plain
   * "Generate new image" button sends.
   */
  edits?: PendingRegenerateEdit[];
}

/**
 * Re-roll the asset on one post.
 *
 * The response is a SUMMARY of the re-roll (`{ id, attemptId, attemptNumber,
 * graphicId | videoId, item }`), not a bare item row — this used to be parsed
 * as `contentBatchItemSchema`, which failed validation on every call and,
 * because response parsing defaults to report-mode, did so silently while
 * handing callers an object typed as something it was not.
 *
 * `result.id` is the SLOT, and equals the `itemId` passed in: a re-roll appends
 * a cut to the post that was already there. Callers must NOT re-point their
 * selection at it — that was the old behaviour, and following it is what took
 * the review thread away from the post the owner was looking at.
 */
export const useRegenerateBatchItem = (
  options?: UseRegenerateBatchItemOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      itemId,
      reason,
      slideIndex,
      edits,
    }: RegenerateArgs) => {
      const body: RegenerateBatchItemInput = {};
      if (reason) body.reason = reason;
      if (slideIndex !== undefined) body.slideIndex = slideIndex;
      if (edits?.length) body.edits = edits;
      return apiClient.post<RegenerateBatchItemResponse>(
        `content-batches/items/${itemId}/regenerate`,
        body,
        { schema: regenerateBatchItemResponseSchema }
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.all(),
      });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to regenerate item');
      options?.onError?.(error);
    },
  });

  return {
    regenerateBatchItem: mutation.mutate,
    regenerateBatchItemAsync: mutation.mutateAsync,
    isRegenerating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
