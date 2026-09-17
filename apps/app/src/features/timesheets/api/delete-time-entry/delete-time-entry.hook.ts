import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteTimeEntryOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteTimeEntry = (options?: UseDeleteTimeEntryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`time-entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete time entry');
      options?.onError?.(error);
    },
  });

  return {
    deleteTimeEntry: mutation.mutate,
    deleteTimeEntryAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
