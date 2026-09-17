import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateServiceInput, OrganizationService } from '../types';

interface UseCreateServiceOptions {
  onSuccess?: (service: OrganizationService) => void;
  onError?: (error: Error) => void;
}

export const useCreateService = (options?: UseCreateServiceOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateServiceInput) =>
      apiClient.post<OrganizationService>('organization-services', input),
    // Async so mutateAsync waits for the refetch — otherwise the dialog
    // can close before the list query has updated.
    onSuccess: async (service) => {
      await queryClient.invalidateQueries({
        queryKey: ['organization-services'],
      });
      toast.success('Service created');
      options?.onSuccess?.(service);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create service');
      options?.onError?.(error);
    },
  });

  return {
    createService: mutation.mutate,
    createServiceAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
