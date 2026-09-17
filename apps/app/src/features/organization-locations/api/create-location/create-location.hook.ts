'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { organizationLocationSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateLocationInput, OrganizationLocation } from '../types';

interface UseCreateLocationOptions {
  onSuccess?: (location: OrganizationLocation) => void;
  onError?: (error: Error) => void;
}

export const useCreateLocation = (options?: UseCreateLocationOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateLocationInput) =>
      apiClient.post<OrganizationLocation>('organization-locations', input, {
        schema: organizationLocationSchema,
      }),
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ['organization-locations'] });
      toast.success('Location added');
      options?.onSuccess?.(location);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add location');
      options?.onError?.(error);
    },
  });

  return {
    createLocation: mutation.mutate,
    createLocationAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
