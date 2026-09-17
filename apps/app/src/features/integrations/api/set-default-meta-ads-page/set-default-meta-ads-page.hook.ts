import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SetDefaultMetaAdsPageResponse } from '../../types';

interface UseSetDefaultMetaAdsPageOptions {
  onSuccess?: (
    integration: SetDefaultMetaAdsPageResponse['integration']
  ) => void;
  onError?: (error: Error) => void;
}

export const useSetDefaultMetaAdsPage = (
  options?: UseSetDefaultMetaAdsPageOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (pageId: string) =>
      apiClient.put<SetDefaultMetaAdsPageResponse>(
        `integrations/meta-ads/pages/${pageId}/default`
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'meta-ads'],
      });
      toast.success('Default page updated');
      options?.onSuccess?.(data.integration);
    },
    onError: (error: Error) => {
      toast.error(`Failed to set default page: ${error.message}`);
      options?.onError?.(error);
    },
  });

  return {
    setDefaultPage: mutation.mutate,
    setDefaultPageAsync: mutation.mutateAsync,
    isSettingDefault: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
