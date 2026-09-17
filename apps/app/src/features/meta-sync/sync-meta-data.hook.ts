import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// The sync now runs asynchronously on the worker fleet; the endpoint just
// enqueues and returns. Fresh data lands in the cache via the query
// invalidations below once the worker finishes (and on the next refetch).
export interface SyncMetaDataResponse {
  queued: boolean;
}

interface UseSyncMetaDataOptions {
  onSuccess?: (data: SyncMetaDataResponse) => void;
  onError?: (error: Error) => void;
}

export const useSyncMetaData = (options?: UseSyncMetaDataOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<SyncMetaDataResponse>('meta-campaigns/sync-all'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    syncMetaData: mutation.mutate,
    syncMetaDataAsync: mutation.mutateAsync,
    isSyncing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
  };
};
