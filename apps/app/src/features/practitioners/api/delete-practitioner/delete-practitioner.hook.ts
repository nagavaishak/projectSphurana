import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeletePractitionerOptions {
  onSuccess?: () => void;
}

export const useDeletePractitioner = (
  options?: UseDeletePractitionerOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`practitioners/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      toast.success('Practitioner deactivated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to deactivate practitioner');
    },
  });

  return {
    deletePractitioner: mutation.mutate,
    deletePractitionerAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
