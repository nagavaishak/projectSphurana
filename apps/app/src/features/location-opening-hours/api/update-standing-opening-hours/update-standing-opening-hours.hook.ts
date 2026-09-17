'use client';

import { apiClient } from '@borradh-workspace/api-client';
import type {
  LocationOpeningHours,
  OrganizationLocation,
  UpdateStandingOpeningHoursInput,
} from '@borradh-workspace/api-client/types';
import { organizationLocationSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseUpdateStandingOpeningHoursOptions {
  onSuccess?: (location: OrganizationLocation) => void;
  onError?: (error: Error) => void;
}

export const useUpdateStandingOpeningHours = (
  options?: UseUpdateStandingOpeningHoursOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      locationId,
      openingHours,
    }: {
      locationId: string;
      openingHours: LocationOpeningHours | null;
    }) =>
      apiClient.put<OrganizationLocation>(
        `locations/${locationId}/opening-hours/standing`,
        { openingHours } satisfies UpdateStandingOpeningHoursInput,
        { schema: organizationLocationSchema }
      ),
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ['location-opening-hours'] });
      queryClient.invalidateQueries({ queryKey: ['organization-locations'] });
      toast.success('Opening hours updated');
      options?.onSuccess?.(location);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update opening hours');
      options?.onError?.(error);
    },
  });

  return {
    updateStandingOpeningHours: mutation.mutate,
    updateStandingOpeningHoursAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
