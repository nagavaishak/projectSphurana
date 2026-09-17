import { apiClient } from '@borradh-workspace/api-client';
import type { StripeConnectStatus } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccountStatusQueryOptions } from '../get-account-status';

/**
 * Force a live sync of the connected account from Stripe and prime the
 * account-status cache with the result. Used when the user returns from
 * hosted onboarding, before Stripe's account.updated webhook has arrived.
 */
export const useRefreshAccountStatus = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<StripeConnectStatus>(
        'integrations/stripe/account-refresh',
        {}
      ),
    onSuccess: (status) => {
      queryClient.setQueryData(getAccountStatusQueryOptions().queryKey, status);
    },
  });

  return {
    refreshAccountStatus: mutation.mutate,
    refreshAccountStatusAsync: mutation.mutateAsync,
    isRefreshing: mutation.isPending,
  };
};
