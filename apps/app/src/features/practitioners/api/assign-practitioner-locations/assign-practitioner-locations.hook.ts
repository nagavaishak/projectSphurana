import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { AssignPractitionerLocationsIntent } from './assign-practitioner-locations.payload';
import { buildAssignPractitionerLocationsPayload } from './assign-practitioner-locations.payload';

interface UseAssignPractitionerLocationsOptions {
  onSuccess?: () => void;
}

export const useAssignPractitionerLocations = (
  options?: UseAssignPractitionerLocationsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      practitionerId,
      ...intent
    }: AssignPractitionerLocationsIntent & { practitionerId: string }) =>
      apiClient.put(
        `practitioners/${practitionerId}/locations`,
        buildAssignPractitionerLocationsPayload(intent)
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      queryClient.invalidateQueries({
        queryKey: ['practitioners', variables.practitionerId],
      });
      toast.success('Locations updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to assign locations');
    },
  });

  return {
    assignLocations: mutation.mutate,
    assignLocationsAsync: mutation.mutateAsync,
    isAssigning: mutation.isPending,
  };
};
