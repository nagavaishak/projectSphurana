import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrganizationService } from '../types';

interface SeedServicesInput {
  businessType:
    | 'hairdresser'
    | 'barber'
    | 'salon'
    | 'spa'
    | 'nail_salon'
    | 'tattoo_studio'
    | 'other';
}

interface UseSeedServicesOptions {
  onSuccess?: (services: OrganizationService[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Seed Default Services Hook
 * Seeds default services for an organization based on business type
 */
export const useSeedServices = (options?: UseSeedServicesOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SeedServicesInput) =>
      apiClient.post<OrganizationService[]>(
        'organization-services/seed',
        input
      ),
    onSuccess: (services) => {
      queryClient.invalidateQueries({ queryKey: ['organization-services'] });
      toast.success(`${services.length} services added`);
      options?.onSuccess?.(services);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to seed services');
      options?.onError?.(error);
    },
  });

  return {
    seedServices: mutation.mutate,
    seedServicesAsync: mutation.mutateAsync,
    isSeeding: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
