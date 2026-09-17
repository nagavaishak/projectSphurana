import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteAppointmentOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteAppointment = (options?: UseDeleteAppointmentOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`appointments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Appointment deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete appointment');
      options?.onError?.(error);
    },
  });

  return {
    deleteAppointment: mutation.mutate,
    deleteAppointmentAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
