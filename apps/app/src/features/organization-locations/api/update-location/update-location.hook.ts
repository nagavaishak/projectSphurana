'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { organizationLocationSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrganizationLocation, UpdateLocationInput } from '../types';

interface UseUpdateLocationOptions {
  onSuccess?: (location: OrganizationLocation) => void;
  onError?: (error: Error) => void;
}

export const useUpdateLocation = (options?: UseUpdateLocationOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateLocationInput & { id: string }) =>
      apiClient.put<OrganizationLocation>(
        `organization-locations/${id}`,
        input,
        { schema: organizationLocationSchema }
      ),
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ['organization-locations'] });
      toast.success('Location updated');
      options?.onSuccess?.(location);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update location');
      options?.onError?.(error);
    },
  });

  return {
    updateLocation: mutation.mutate,
    updateLocationAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
