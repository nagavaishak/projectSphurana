import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface SeedSubscriptionResponse {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  currentPeriodEnd: string | null;
}

/**
 * Attach a subscription that already exists in Stripe to an organization.
 *
 * For customers who paid during the sales call rather than through onboarding
 * — without this their workspace looks unsubscribed and has no credits.
 */
export const useSeedSubscription = (
  organizationId: string,
  options?: { onSuccess?: (result: SeedSubscriptionResponse) => void }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (stripeRef: string) =>
      apiClient.post<SeedSubscriptionResponse>(
        `admin-terminal/organizations/${organizationId}/subscription/seed`,
        { stripeRef }
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.adminTerminal.all(),
      });
      toast.success(
        `Subscription ${result.status} — ${result.stripeSubscriptionId}`
      );
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      // The server says which of the real mistakes this was — wrong org, a
      // cancelled subscription, a customer with none — and that is the only
      // thing that tells the operator what to do next.
      toast.error(error.message || 'Could not seed that subscription');
    },
  });

  return {
    seedSubscription: mutation.mutate,
    isSeeding: mutation.isPending,
    seeded: mutation.data ?? null,
  };
};
