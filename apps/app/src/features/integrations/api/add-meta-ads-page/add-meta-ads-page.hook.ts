import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AddMetaAdsPageInput, AddMetaAdsPageResponse } from '../../types';

interface UseAddMetaAdsPageOptions {
  onSuccess?: (page: AddMetaAdsPageResponse['page']) => void;
  onError?: (error: Error) => void;
}

export const useAddMetaAdsPage = (options?: UseAddMetaAdsPageOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: AddMetaAdsPageInput) =>
      apiClient.post<AddMetaAdsPageResponse>(
        'integrations/meta-ads/pages',
        input
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'meta-ads'],
      });
      toast.success('Page added successfully');
      options?.onSuccess?.(data.page);
    },
    onError: (error: Error) => {
      toast.error(`Failed to add page: ${error.message}`);
      options?.onError?.(error);
    },
  });

  return {
    addPage: mutation.mutate,
    addPageAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
