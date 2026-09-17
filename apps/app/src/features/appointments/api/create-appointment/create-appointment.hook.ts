import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Appointment, CreateAppointmentInput } from '../types';
import {
  type DoubleBookingConflict,
  asDoubleBookingConflict,
} from './double-booking-conflict';

interface UseCreateAppointmentOptions {
  onSuccess?: (appointment: Appointment) => void;
  onError?: (error: Error) => void;
  /**
   * Called instead of the error toast when the server refuses because the slot
   * overlaps an existing appointment for the same team member.
   *
   * That refusal is a QUESTION, not a failure — the caller is expected to ask
   * the user whether to double-book and, if so, re-send with
   * `allowDoubleBooking: true`. A red "failed" toast on top of that dialog
   * would say the opposite of what is happening (ENG-792).
   */
  onDoubleBookingConflict?: (conflict: DoubleBookingConflict) => void;
}

export const useCreateAppointment = (options?: UseCreateAppointmentOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateAppointmentInput) =>
      apiClient.post<Appointment>('appointments', input),
    onSuccess: (appointment) => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      // A booking that required a room now HOLDS one. The rooms calendar and
      // the utilisation figures read those holds from their own queries, so
      // without this the new block sat in "Unassigned" (with no turnaround
      // tail) until the allocations query happened to go stale.
      queryClient.invalidateQueries({
        queryKey: queryKeys.resources.allAllocations(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.resources.allUtilisation(),
      });
      toast.success('Appointment created');
      options?.onSuccess?.(appointment);
    },
    onError: (error: Error) => {
      const conflict = options?.onDoubleBookingConflict
        ? asDoubleBookingConflict(error)
        : null;
      if (conflict) {
        options?.onDoubleBookingConflict?.(conflict);
        return;
      }
      toast.error(error.message || 'Failed to create appointment');
      options?.onError?.(error);
    },
  });

  return {
    createAppointment: mutation.mutate,
    createAppointmentAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
