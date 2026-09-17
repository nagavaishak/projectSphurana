import { apiClient } from '@borradh-workspace/api-client';

import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface AddServiceLocationsInput {
  serviceId: string;
  locationIds: string[];
}

interface UseAddServiceLocationsOptions {
  onSuccess?: () => void;
}

/**
 * Offer a service at more branches — the write behind "import from another
 * location".
 *
 * POST, not the PUT beside it: the PUT REPLACES the whole assignment set, and
 * the per-branch price overrides it would need are on no read path, so a
 * client-side "existing ∪ target" silently blanks them. The server merges.
 */
export const useAddServiceLocations = (
  options?: UseAddServiceLocationsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ serviceId, locationIds }: AddServiceLocationsInput) =>
      apiClient.post(`organization-services/${serviceId}/locations`, {
        locationIds,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.all(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.detail(variables.serviceId),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import');
    },
  });

  return {
    addServiceLocations: mutation.mutate,
    addServiceLocationsAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
  };
};
