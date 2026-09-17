'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { GeneralBookingResult, SubmitGeneralBookingInput } from '../types';

interface SubmitGeneralBookingParams extends SubmitGeneralBookingInput {
  organizationSlug: string;
}

export const useSubmitGeneralBooking = (options?: {
  onSuccess?: (result: GeneralBookingResult) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      organizationSlug,
      ...input
    }: SubmitGeneralBookingParams) => {
      return apiClient.post<GeneralBookingResult>(
        `public/booking/${organizationSlug}/submit`,
        input
      );
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['general-booking-slots', variables.organizationSlug],
      });
      // Don't claim "confirmed" when a deposit is still owed — the booking is
      // only held until the customer pays. The caller redirects to Stripe.
      if (result.deposit?.checkoutUrl) {
        toast.info('Redirecting to secure payment…');
      } else {
        toast.success("Booking confirmed! We'll be in touch soon.");
      }
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not submit your booking');
      options?.onError?.(error);
    },
  });

  return {
    submitBooking: mutation.mutate,
    submitBookingAsync: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
  };
};
