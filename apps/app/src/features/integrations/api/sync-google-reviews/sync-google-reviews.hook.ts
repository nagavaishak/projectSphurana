import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SyncGoogleReviewsResponse } from '../../types';

interface UseSyncGoogleReviewsOptions {
  onSuccess?: (data: SyncGoogleReviewsResponse) => void;
}

export const useSyncGoogleReviews = (options?: UseSyncGoogleReviewsOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (accountId: string) =>
      apiClient.post<SyncGoogleReviewsResponse>(
        `integrations/google-my-business/accounts/${accountId}/sync`
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'google-my-business'],
      });
      toast.success(`Synced ${data.synced} reviews`);
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      toast.error(`Failed to sync reviews: ${error.message}`);
    },
  });

  return {
    syncReviews: mutation.mutate,
    syncReviewsAsync: mutation.mutateAsync,
    isSyncing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
