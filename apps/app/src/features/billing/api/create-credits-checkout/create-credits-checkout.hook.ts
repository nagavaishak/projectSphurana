import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CheckoutSessionResult,
  CreateCreditsCheckoutInput,
} from '../types';

interface UseCreateCreditsCheckoutOptions {
  onSuccess?: (result: CheckoutSessionResult) => void;
  onError?: (error: Error) => void;
}

export const useCreateCreditsCheckout = (
  options?: UseCreateCreditsCheckoutOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateCreditsCheckoutInput) =>
      apiClient.post<CheckoutSessionResult>('billing/credits/checkout', input),
    onSuccess: (result) => {
      trackEvent('credits_checkout_started');
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
