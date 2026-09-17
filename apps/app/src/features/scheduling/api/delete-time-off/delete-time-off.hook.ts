import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteTimeOffOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteTimeOff = (options?: UseDeleteTimeOffOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: true }>(`time-off/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-off'] });
      toast.success('Time off deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete time off');
      options?.onError?.(error);
    },
  });

  return {
    deleteTimeOff: mutation.mutate,
    deleteTimeOffAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
