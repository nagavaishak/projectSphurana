import { apiClient } from '@borradh-workspace/api-client';

import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface AddMembershipPlanLocationsInput {
  planId: string;
  locationIds: string[];
}

interface UseAddMembershipPlanLocationsOptions {
  onSuccess?: () => void;
}

/**
 * Make an existing membership plan available at more branches — the write behind
 * "import from another location".
 *
 * POST, not the PUT beside it: the PUT REPLACES the whole assignment set, so a
 * client-side "existing ∪ target" has to resend state it may not hold. The
 * server merges instead.
 */
export const useAddMembershipPlanLocations = (
  options?: UseAddMembershipPlanLocationsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ planId, locationIds }: AddMembershipPlanLocationsInput) =>
      apiClient.post(`membership-plans/${planId}/locations`, { locationIds }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.membershipPlans.all(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.membershipPlans.detail(variables.planId),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import');
    },
  });

  return {
    addMembershipPlanLocations: mutation.mutate,
    addMembershipPlanLocationsAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
  };
};
