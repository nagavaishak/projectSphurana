import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteServiceOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteService = (options?: UseDeleteServiceOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`organization-services/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['organization-services'],
      });
      toast.success('Service deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete service');
      options?.onError?.(error);
    },
  });

  return {
    deleteService: mutation.mutate,
    deleteServiceAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
