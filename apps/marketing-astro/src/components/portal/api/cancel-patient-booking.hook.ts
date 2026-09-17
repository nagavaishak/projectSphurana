'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';

export interface CancelPatientBookingInput {
  appointmentId: string;
  reason?: string;
}

export interface CancelPatientBookingResponse {
  appointmentId: string;
  policyAtCancellation: {
    isWithinFreeWindow: boolean;
    noticeRequiredHours: number;
    lateFeeCents: number | null;
  };
}

interface UseCancelPatientBookingOptions {
  onSuccess?: (data: CancelPatientBookingResponse) => void;
  onError?: (error: Error) => void;
}

export const useCancelPatientBooking = (
  options?: UseCancelPatientBookingOptions
) => {
  const { organizationSlug } = usePortal();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ appointmentId, reason }: CancelPatientBookingInput) =>
      patientFetch<CancelPatientBookingResponse>(
        `${PATIENT_PORTAL_PATHS.bookings}/${appointmentId}/cancel`,
        { method: 'POST', body: { reason }, organizationSlug }
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: patientPortalKeys.bookings(organizationSlug),
      });
      toast.success('Your booking has been cancelled');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not cancel your booking');
      options?.onError?.(error);
    },
  });

  return {
    cancelBooking: mutation.mutate,
    cancelBookingAsync: mutation.mutateAsync,
    isCancelling: mutation.isPending,
  };
};
