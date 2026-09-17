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
 * Attach a subscription bought outside the product — on a sales call — to this
 * workspace.
 *
 * The customer-facing twin of the admin-terminal action, for the common case
 * where an onboarding specialist is working inside the customer's account
 * rather than beside it.
 */
export const useSeedSubscription = (options?: {
  onSuccess?: (result: SeedSubscriptionResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (stripeRef: string) =>
      apiClient.post<SeedSubscriptionResponse>('billing/subscription/seed', {
        stripeRef,
      }),
    onSuccess: (result) => {
      // Plan state, credit balance and every paid-plan gate read off these.
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.all() });
      toast.success('Subscription attached');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      // The server names the actual problem — a cancelled subscription, a
      // customer with none, one already attached to another workspace — and
      // that is the only thing that says what to do next.
      toast.error(error.message || 'Could not attach that subscription');
    },
  });

  return {
    seedSubscription: mutation.mutate,
    isSeeding: mutation.isPending,
  };
};
