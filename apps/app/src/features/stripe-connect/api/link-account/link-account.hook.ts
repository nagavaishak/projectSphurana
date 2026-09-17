import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  LinkStripeAccountInput,
  StripeConnectStatus,
} from '@borradh-workspace/api-client/types';
import { stripeConnectStatusSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getAccountStatusQueryOptions } from '../get-account-status';

interface UseLinkStripeAccountOptions {
  onSuccess?: (status: StripeConnectStatus) => void;
}

/**
 * Connect an account the merchant already onboarded with Stripe, by its
 * `acct_` id. The endpoint answers with the same payload as account-status,
 * so the panel can switch to its connected state without a refetch.
 */
export const useLinkStripeAccount = (options?: UseLinkStripeAccountOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: LinkStripeAccountInput) =>
      apiClient.post<StripeConnectStatus>(
        'integrations/stripe/link-account',
        input,
        { schema: stripeConnectStatusSchema }
      ),
    onSuccess: (status) => {
      queryClient.setQueryData(getAccountStatusQueryOptions().queryKey, status);
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.stripe(),
      });
      toast.success('Stripe account connected');
      options?.onSuccess?.(status);
    },
    onError: (error: Error) => {
      // The server's message names the actual problem — a mistyped id, an
      // account already linked to another workspace — so it is worth showing
      // verbatim rather than replacing with a generic failure.
      toast.error(error.message || 'Could not link that Stripe account');
    },
  });

  return {
    linkStripeAccount: mutation.mutate,
    linkStripeAccountAsync: mutation.mutateAsync,
    isLinking: mutation.isPending,
  };
};
