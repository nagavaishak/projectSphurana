import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrganizationService, UpdateServiceInput } from '../types';

interface UseUpdateServiceOptions {
  onSuccess?: (service: OrganizationService) => void;
  onError?: (error: Error) => void;
  showSuccessToast?: boolean;
}

export const useUpdateService = (options?: UseUpdateServiceOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateServiceInput & { id: string }) =>
      apiClient.put<OrganizationService>(`organization-services/${id}`, input),
    onSuccess: async (service) => {
      await queryClient.invalidateQueries({
        queryKey: ['organization-services'],
      });
      if (options?.showSuccessToast !== false) {
        toast.success('Service updated');
      }
      options?.onSuccess?.(service);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update service');
      options?.onError?.(error);
    },
  });

  return {
    updateService: mutation.mutate,
    updateServiceAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
