import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RemoveMetaAdsPageResponse } from '../../types';

interface UseRemoveMetaAdsPageOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useRemoveMetaAdsPage = (options?: UseRemoveMetaAdsPageOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (pageId: string) =>
      apiClient.delete<RemoveMetaAdsPageResponse>(
        `integrations/meta-ads/pages/${pageId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'meta-ads'],
      });
      toast.success('Page removed successfully');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove page: ${error.message}`);
      options?.onError?.(error);
    },
  });

  return {
    removePage: mutation.mutate,
    removePageAsync: mutation.mutateAsync,
    isRemoving: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
