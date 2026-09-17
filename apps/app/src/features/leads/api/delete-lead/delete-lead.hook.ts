import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Delete Lead Hook
 * Deletes a lead by ID
 */
export const useDeleteLead = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (leadId: string) => {
      return apiClient.delete(`leads/${leadId}`);
    },
    onSuccess: () => {
      // Invalidate leads list
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Client deleted successfully');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete client');
      options?.onError?.(error);
    },
  });

  return {
    deleteLead: mutation.mutate,
    deleteLeadAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
