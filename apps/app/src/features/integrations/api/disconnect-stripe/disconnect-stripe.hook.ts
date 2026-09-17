import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDisconnectStripeOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDisconnectStripe = (options?: UseDisconnectStripeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.delete<{ success: boolean }>('integrations/stripe/integration'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'stripe'] });
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Stripe account disconnected');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disconnect Stripe account');
      options?.onError?.(error);
    },
  });

  return {
    disconnectStripe: mutation.mutate,
    disconnectStripeAsync: mutation.mutateAsync,
    isDisconnecting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
