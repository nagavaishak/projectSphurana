import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

interface AddPractitionerLocationsInput {
  practitionerId: string;
  locationIds: string[];
}

interface UseAddPractitionerLocationsOptions {
  onSuccess?: () => void;
}

/**
 * Let an existing team member also work at more branches.
 *
 * POST, not the PUT beside it: that one REPLACES the set, so a caller holding
 * a stale list silently takes someone off a branch they have bookings at.
 */
export const useAddPractitionerLocations = (
  options?: UseAddPractitionerLocationsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      practitionerId,
      locationIds,
    }: AddPractitionerLocationsInput) =>
      apiClient.post(`practitioners/${practitionerId}/locations`, {
        locationIds,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.practitioners.all(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.practitioners.detail(variables.practitionerId),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add to this location');
    },
  });

  return {
    addPractitionerLocations: mutation.mutate,
    addPractitionerLocationsAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
  };
};
