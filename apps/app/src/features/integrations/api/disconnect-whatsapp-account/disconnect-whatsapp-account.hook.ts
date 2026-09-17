import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDisconnectWhatsAppAccount = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (accountId: string) =>
      apiClient.delete<{ success: boolean }>(
        `integrations/whatsapp/accounts/${accountId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'whatsapp', 'accounts'],
      });
      if (toastOnSuccess)
        toast.success('WhatsApp account disconnected successfully');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to disconnect WhatsApp: ${error.message}`);
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
