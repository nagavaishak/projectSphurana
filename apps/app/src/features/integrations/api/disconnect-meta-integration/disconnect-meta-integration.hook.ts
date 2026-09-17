import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDisconnectMetaIntegration = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.delete<{ success: boolean }>(
        'integrations/meta-ads/integration'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'meta-ads'],
      });
      if (toastOnSuccess) toast.success('Meta Ads disconnected successfully');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to disconnect Meta Ads: ${error.message}`);
    },
  });

  return {
    disconnect: mutation.mutate,
    disconnectAsync: mutation.mutateAsync,
    isDisconnecting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
