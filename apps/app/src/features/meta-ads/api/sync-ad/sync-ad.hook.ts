import { apiClient } from '@borradh-workspace/api-client';
import { syncAdResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SyncAdResponse } from '../types';

/**
 * Sync ad hook
 * Syncs ad status from Meta
 */
export const useSyncAd = (toastOnSuccess = true, toastOnError = true) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (adId: string) => {
      return apiClient.post<SyncAdResponse>(
        `meta-ads/${adId}/sync`,
        undefined,
        {
          schema: syncAdResponseSchema,
        }
      );
    },
    onSuccess: (data, adId) => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads', adId] });
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess && data.synced) {
        toast.success('Ad synced with Meta');
      }
    },
    onError: (error) => {
      if (toastOnError) toast.error(`Failed to sync ad: ${error.message}`);
    },
  });

  return {
    ...mutation,
    execute: mutation.mutate,
    executeAsync: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
