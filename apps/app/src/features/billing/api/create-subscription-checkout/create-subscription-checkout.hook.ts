import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CheckoutSessionResult,
  CreateSubscriptionCheckoutInput,
} from '../types';

interface UseCreateSubscriptionCheckoutOptions {
  onSuccess?: (result: CheckoutSessionResult) => void;
  onError?: (error: Error) => void;
}

export const useCreateSubscriptionCheckout = (
  options?: UseCreateSubscriptionCheckoutOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateSubscriptionCheckoutInput) =>
      apiClient.post<CheckoutSessionResult>(
        'billing/subscription/checkout',
        input
      ),
    onSuccess: (result) => {
      trackEvent('subscription_checkout_started');
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      options?.onSuccess?.(result);
      // Redirect to Stripe Checkout
      if (result.url) {
        window.location.href = result.url;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create checkout session');
      options?.onError?.(error);
    },
  });

  return {
    createCheckout: mutation.mutate,
    createCheckoutAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
