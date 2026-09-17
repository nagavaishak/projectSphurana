'use client';

import { apiClient } from '@borradh-workspace/api-client';
import type {
  CancelManagedAppointmentResponse,
  ManagedAppointment,
  RescheduleManagedAppointmentResponse,
} from '@borradh-workspace/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * The patient's self-serve manage-booking surface.
 *
 * The token is the credential, so it lives in the path and nowhere else — not
 * in a query string (which lands in referrer headers and server access logs)
 * and not in localStorage.
 */

const manageKey = (organizationSlug: string, token: string) =>
  ['managed-booking', organizationSlug, token] as const;

export const getManagedBookingQueryOptions = (
  organizationSlug: string,
  token: string
) =>
  queryOptions({
    queryKey: manageKey(organizationSlug, token),
    queryFn: async () =>
      apiClient.get<ManagedAppointment>(
        `public/booking/${organizationSlug}/manage/${encodeURIComponent(token)}`
      ),
    enabled: !!organizationSlug && !!token,
    // The cancellation policy is time-sensitive (the free window closes as the
    // appointment approaches), so don't serve a stale "you can cancel free"
    // that has since expired.
    staleTime: 0,
    retry: false,
  });

export const useGetManagedBooking = (
  organizationSlug: string,
  token: string
) => {
  const query = useQuery(
    getManagedBookingQueryOptions(organizationSlug, token)
  );

  return {
    booking: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const useCancelManagedBooking = (
  organizationSlug: string,
  token: string,
  options?: { onSuccess?: (r: CancelManagedAppointmentResponse) => void }
) => {
  const mutation = useMutation({
    mutationFn: async (input: { reason?: string }) =>
      apiClient.post<CancelManagedAppointmentResponse>(
        `public/booking/${organizationSlug}/manage/${encodeURIComponent(token)}/cancel`,
        input
      ),
    onSuccess: (result) => {
      toast.success('Your booking has been cancelled');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not cancel your booking');
    },
  });

  return {
    cancelBooking: mutation.mutate,
    isCancelling: mutation.isPending,
  };
};

export const useRescheduleManagedBooking = (
  organizationSlug: string,
  token: string,
  options?: { onSuccess?: (r: RescheduleManagedAppointmentResponse) => void }
) => {
  const mutation = useMutation({
    mutationFn: async (input: { startDate: string }) =>
      apiClient.post<RescheduleManagedAppointmentResponse>(
        `public/booking/${organizationSlug}/manage/${encodeURIComponent(token)}/reschedule`,
        input
      ),
    onSuccess: (result) => {
      toast.success('Your booking has been moved');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      // A CONFLICT here is the expected race — someone took the slot between
      // the page rendering it and the patient tapping it. The message from the
      // API already says "pick another", so surface it verbatim.
      toast.error(error.message || 'Could not move your booking');
    },
  });

  return {
    rescheduleBooking: mutation.mutate,
    isRescheduling: mutation.isPending,
  };
};
