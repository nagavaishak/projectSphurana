import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type UndoRegenerateResponse,
  undoRegenerateResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type UseUndoRegenerateOptions = {
  onSuccess?: (result: UndoRegenerateResponse) => void;
  onError?: (error: Error) => void;
};

/**
 * Go back to the previous cut of a post.
 *
 * Instant: the previous attempt's asset was never destroyed, so this is a
 * pointer move on the server and there is nothing to poll. It does NOT refund a
 * regeneration — the render was really paid for — which is why the toast says
 * so rather than letting the count look like a bug.
 *
 * No body: there is exactly one place to go back to. `canUndoRegenerate` on the
 * item says whether the button should be there at all.
 */
export const useUndoRegenerate = (options?: UseUndoRegenerateOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (itemId: string) =>
      apiClient.post<UndoRegenerateResponse>(
        `content-batches/items/${itemId}/undo-regenerate`,
        undefined,
        { schema: undoRegenerateResponseSchema }
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.all(),
      });
      // The thread gained a turn recording the revert, and it is keyed by item.
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.itemMessages(result.id),
      });
      // A video's clip filmstrip belongs to the cut, so going back changes it.
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentBatches.itemClips(result.id),
      });
      toast.success('Back to the previous version');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to go back');
      options?.onError?.(error);
    },
  });

  return {
    undoRegenerate: mutation.mutate,
    undoRegenerateAsync: mutation.mutateAsync,
    isUndoing: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
