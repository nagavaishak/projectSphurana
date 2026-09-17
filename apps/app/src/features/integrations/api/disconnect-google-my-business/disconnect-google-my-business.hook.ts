import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDisconnectGoogleMyBusiness = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (accountId: string) =>
      apiClient.delete<{ success: boolean }>(
        `integrations/google-my-business/accounts/${accountId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'google-my-business', 'accounts'],
      });
      if (toastOnSuccess) {
        toast.success('Google My Business account disconnected successfully');
      }
    },
    onError: (error) => {
      if (toastOnError) {
        toast.error(`Failed to disconnect account: ${error.message}`);
      }
    },
  });

  return {
    disconnect: mutation.mutate,
    disconnectAsync: mutation.mutateAsync,
    isDisconnecting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
