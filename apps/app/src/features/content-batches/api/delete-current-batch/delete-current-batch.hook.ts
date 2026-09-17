import { apiClient } from '@borradh-workspace/api-client';
import {
  type DeleteCurrentBatchResponse,
  deleteCurrentBatchResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type UseDeleteCurrentBatchOptions = {
  onSuccess?: (response: DeleteCurrentBatchResponse) => void;
  onError?: (error: Error) => void;
};

/**
 * Reset bulk content: clear this month's batch so the planner's Bulk Create
 * button re-enables. Keeps the generated graphics/videos and their posts —
 * only the batch row is removed. Invalidates the batch query (and the asset
 * libraries, harmless) so the planner reflects the cleared state.
 */
export const useDeleteCurrentBatch = (
  options?: UseDeleteCurrentBatchOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.delete<DeleteCurrentBatchResponse>('content-batches/current', {
        schema: deleteCurrentBatchResponseSchema,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['content-batches'] });
      queryClient.invalidateQueries({ queryKey: ['graphics'] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      toast.success(
        response.deleted
          ? 'Bulk content reset — you can generate a new batch now.'
          : 'No batch to reset this month.'
      );
      options?.onSuccess?.(response);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset bulk content');
      options?.onError?.(error);
    },
  });

  return {
    resetBulkContent: mutation.mutate,
    resetBulkContentAsync: mutation.mutateAsync,
    isResetting: mutation.isPending,
  };
};
