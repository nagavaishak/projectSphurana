import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { openProviderOAuthUrl } from '@/lib/open-integration-oauth';

interface InitiateStripeConnectResponse {
  authUrl: string;
}

interface UseInitiateStripeConnectOptions {
  returnTo?: string;
  onSuccess?: (authUrl: string) => void;
  onError?: (error: Error) => void;
}

export const useInitiateStripeConnect = (
  options?: UseInitiateStripeConnectOptions
) => {
  const mutation = useMutation({
    mutationFn: () => {
      const params = options?.returnTo
        ? `?returnTo=${encodeURIComponent(options.returnTo)}`
        : '';
      return apiClient.get<InitiateStripeConnectResponse>(
        `integrations/stripe/auth${params}`
      );
    },
    onSuccess: (response) => {
      options?.onSuccess?.(response.authUrl);
      void openProviderOAuthUrl(response.authUrl);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to initiate Stripe Connect');
      options?.onError?.(error);
    },
  });

  return {
    initiateStripeConnect: mutation.mutate,
    initiateStripeConnectAsync: mutation.mutateAsync,
    isInitiating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
