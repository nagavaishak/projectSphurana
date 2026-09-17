import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteBlockedTimeTypeOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteBlockedTimeType = (
  options?: UseDeleteBlockedTimeTypeOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: true }>(`blocked-time-types/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-time-types'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-time'] });
      toast.success('Blocked time type deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete blocked time type');
      options?.onError?.(error);
    },
  });

  return {
    deleteBlockedTimeType: mutation.mutate,
    deleteBlockedTimeTypeAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
