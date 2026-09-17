import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDisconnectEmailAccount = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (accountId: string) =>
      apiClient.delete<{ success: boolean }>(
        `integrations/email/accounts/${accountId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'email', 'accounts'],
      });
      if (toastOnSuccess) toast.success('Email account disconnected');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to disconnect email: ${error.message}`);
    },
  });

  return {
    ...mutation,
    disconnect: mutation.mutate,
    disconnectAsync: mutation.mutateAsync,
    isDisconnecting: mutation.isPending,
  };
};
