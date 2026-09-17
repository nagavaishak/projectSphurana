import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Delete Integration Hook
 * Deletes an integration by ID
 */
export const useDeleteIntegration = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (integrationId: string) => {
      return apiClient.delete(`integrations/${integrationId}`);
    },
    onSuccess: () => {
      // Invalidate integrations list
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Integration deleted successfully');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete integration');
      options?.onError?.(error);
    },
  });

  return {
    deleteIntegration: mutation.mutate,
    deleteIntegrationAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
