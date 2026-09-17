import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface DeleteShiftOverrideVariables {
  practitionerId: string;
  /** YYYY-MM-DD */
  date: string;
}

interface UseDeleteShiftOverrideOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteShiftOverride = (
  options?: UseDeleteShiftOverrideOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ practitionerId, date }: DeleteShiftOverrideVariables) =>
      apiClient.delete<{ success: true }>(
        `shifts/override/${practitionerId}/${date}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Reverted to weekly schedule');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove shift override');
      options?.onError?.(error);
    },
  });

  return {
    deleteShiftOverride: mutation.mutate,
    deleteShiftOverrideAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
