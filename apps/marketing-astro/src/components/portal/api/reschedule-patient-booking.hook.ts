'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';

export interface ReschedulePatientBookingInput {
  appointmentId: string;
  /** ISO datetime of the new start — must be an offered slot. */
  startTime: string;
}

export interface ReschedulePatientBookingResponse {
  appointmentId: string;
  startDate: string;
  endDate: string;
}

interface UseReschedulePatientBookingOptions {
  onSuccess?: (data: ReschedulePatientBookingResponse) => void;
  onError?: (error: Error) => void;
}

export const useReschedulePatientBooking = (
  options?: UseReschedulePatientBookingOptions
) => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ appointmentId, startTime }: ReschedulePatientBookingInput) =>
      patientFetch<ReschedulePatientBookingResponse>(
        `${PATIENT_PORTAL_PATHS.bookings}/${appointmentId}/reschedule`,
        { method: 'POST', body: { startTime }, organizationSlug }
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: patientPortalKeys.bookings(organizationSlug),
      });
      toast.success('Your booking has been moved');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not move your booking');
      options?.onError?.(error);
    },
  });

  return {
    rescheduleBooking: mutation.mutate,
    rescheduleBookingAsync: mutation.mutateAsync,
    isRescheduling: mutation.isPending,
  };
};
