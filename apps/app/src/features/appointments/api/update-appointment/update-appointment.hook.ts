import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Appointment } from '../types';
import type { UpdateAppointmentIntent } from './update-appointment.input';
import { buildUpdateAppointmentPayload } from './update-appointment.payload';

interface UseUpdateAppointmentOptions {
  onSuccess?: (appointment: Appointment) => void;
  onError?: (error: Error) => void;
}

/**
 * The single mutation entry point for updating an appointment. Callers pass a
 * typed {@link UpdateAppointmentIntent}; the hook runs it through the ONE
 * payload builder and issues the `PUT`. No surface ever assembles the wire body
 * itself, so no two surfaces can build it differently.
 */
export const useUpdateAppointment = (options?: UseUpdateAppointmentOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: UpdateAppointmentIntent) =>
      apiClient.put<Appointment>(
        `appointments/${intent.id}`,
        buildUpdateAppointmentPayload(intent)
      ),
    onSuccess: (appointment) => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({
        queryKey: ['appointments', appointment.id],
      });
      toast.success('Appointment updated');
      options?.onSuccess?.(appointment);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update appointment');
      options?.onError?.(error);
    },
  });

  return {
    updateAppointment: mutation.mutate,
    updateAppointmentAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
