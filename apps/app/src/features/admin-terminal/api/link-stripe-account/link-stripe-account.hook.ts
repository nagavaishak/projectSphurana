import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface LinkStripeAccountResponse {
  stripeAccountId: string;
  accountName: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/**
 * Attach a merchant's Stripe connected account to their organization, from
 * beside the customer rather than inside their account.
 */
export const useLinkStripeAccountForOrg = (
  organizationId: string,
  options?: { onSuccess?: (result: LinkStripeAccountResponse) => void }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (stripeAccountId: string) =>
      apiClient.post<LinkStripeAccountResponse>(
        `admin-terminal/organizations/${organizationId}/stripe/link`,
        { stripeAccountId }
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminTerminal.all(),
      });
      toast.success(
        result.chargesEnabled
          ? 'Stripe account linked — charges enabled'
          : 'Stripe account linked — Stripe is still verifying it'
      );
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      // The server names which mistake this was: an id that is not connected
      // to us, one already claimed by another workspace, a workspace that is
      // already connected to something else.
      toast.error(error.message || 'Could not link that Stripe account');
    },
  });

  return {
    linkStripeAccount: mutation.mutate,
    isLinking: mutation.isPending,
    linked: mutation.data ?? null,
  };
};
