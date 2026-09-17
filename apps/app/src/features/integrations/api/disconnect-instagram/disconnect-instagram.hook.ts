import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDisconnectInstagramIntegration = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.delete<{ success: boolean }>(
        'integrations/instagram/integration'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'instagram'],
      });
      if (toastOnSuccess) toast.success('Instagram disconnected successfully');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to disconnect Instagram: ${error.message}`);
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
