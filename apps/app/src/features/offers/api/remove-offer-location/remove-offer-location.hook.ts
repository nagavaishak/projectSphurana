import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

interface RemoveOfferLocationInput {
  offerId: string;
  locationId: string;
}

interface UseRemoveOfferLocationOptions {
  onSuccess?: () => void;
}

/**
 * Take this branch off the record, leaving it in place everywhere else.
 *
 * The other half of the delete prompt. The server refuses (409) when this is
 * the LAST branch — zero rows reads as "every branch", so a withdrawal has to
 * be a deactivation instead. That message is surfaced verbatim, because it
 * tells the operator exactly what to do next.
 */
export const useRemoveOfferLocation = (
  options?: UseRemoveOfferLocationOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ offerId, locationId }: RemoveOfferLocationInput) =>
      apiClient.delete(`offers/${offerId}/locations/${locationId}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offers.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.offers.detail(variables.offerId),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not remove it from this location');
    },
  });

  return {
    removeOfferLocation: mutation.mutate,
    removeOfferLocationAsync: mutation.mutateAsync,
    isRemoving: mutation.isPending,
  };
};
