'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { organizationLocationSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrganizationLocation } from '../types';

interface UseSetPrimaryLocationOptions {
  onSuccess?: (location: OrganizationLocation) => void;
  onError?: (error: Error) => void;
}

export const useSetPrimaryLocation = (
  options?: UseSetPrimaryLocationOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<OrganizationLocation>(
        `organization-locations/${id}/set-primary`,
        undefined,
        { schema: organizationLocationSchema }
      ),
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ['organization-locations'] });
      toast.success('Primary location updated');
      options?.onSuccess?.(location);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set primary location');
      options?.onError?.(error);
    },
  });

  return {
    setPrimaryLocation: mutation.mutate,
    setPrimaryLocationAsync: mutation.mutateAsync,
    isSettingPrimary: mutation.isPending,
  };
};
