import { apiClient } from '@borradh-workspace/api-client';
import { adSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Ad } from '../types';

/**
 * Duplicate ad hook
 * Borradh-made ads (with a local creative) are duplicated as a draft to
 * review + launch; imported ads are copied server-side on Meta (paused).
 */
export const useDuplicateAd = (toastOnSuccess = true, toastOnError = true) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (adId: string) => {
      return apiClient.post<Ad>(`meta-ads/${adId}/duplicate`, undefined, {
        schema: adSchema,
      });
    },
    onSuccess: (ad) => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) {
        toast.success(
          ad?.status === 'draft'
            ? 'Ad duplicated as a draft — review and launch it when ready'
            : 'Ad duplicated (paused)'
        );
      }
    },
    onError: (error) => {
      if (toastOnError) toast.error(`Failed to duplicate ad: ${error.message}`);
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
