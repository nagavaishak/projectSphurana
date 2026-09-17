import { apiClient } from '@borradh-workspace/api-client';

import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface AddPromotionLocationsInput {
  offerId: string;
  locationIds: string[];
}

interface UseAddOfferLocationsOptions {
  onSuccess?: () => void;
}

/**
 * Make an existing promotion available at more branches — the write behind
 * "import from another location".
 *
 * POST, not the PUT beside it: the PUT REPLACES the whole assignment set, so a
 * client-side "existing ∪ target" has to resend state it may not hold. The
 * server merges instead.
 */
export const useAddOfferLocations = (options?: UseAddOfferLocationsOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ offerId, locationIds }: AddPromotionLocationsInput) =>
      apiClient.post(`offers/${offerId}/locations`, { locationIds }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offers.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.offers.detail(variables.offerId),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import');
    },
  });

  return {
    addOfferLocations: mutation.mutate,
    addOfferLocationsAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
  };
};
