import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDisconnectCalendarAccount = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (accountId: string) =>
      apiClient.delete<{ success: boolean }>(
        `integrations/calendar/accounts/${accountId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'calendar', 'accounts'],
      });
      if (toastOnSuccess) toast.success('Calendar disconnected');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to disconnect calendar: ${error.message}`);
    },
  });

  return {
    ...mutation,
    disconnect: mutation.mutate,
    disconnectAsync: mutation.mutateAsync,
    isDisconnecting: mutation.isPending,
  };
};
