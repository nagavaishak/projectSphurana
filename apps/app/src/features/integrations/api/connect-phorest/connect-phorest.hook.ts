import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ConnectPhorestInput, ConnectPhorestResponse } from '../../types';

export const useConnectPhorest = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: ConnectPhorestInput) =>
      apiClient.post<ConnectPhorestResponse>(
        'integrations/booking/connect/phorest',
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'booking', 'accounts'],
      });
      if (toastOnSuccess) {
        toast.success('Phorest connected successfully');
      }
    },
    onError: (error) => {
      if (toastOnError) {
        toast.error(`Failed to connect Phorest: ${error.message}`);
      }
    },
  });

  return {
    connect: mutation.mutate,
    connectAsync: mutation.mutateAsync,
    isConnecting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
