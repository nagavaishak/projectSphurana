'use client';

/**
 * React Query hooks for the PUBLIC booking endpoints.
 *
 * These are unauthenticated calls, so they go through `@/lib/api-client`
 * (absolute API origin) and NOT through `patient-fetch` — the latter is
 * cookie-only, same-origin, and exists for the signed-in portal. The one place
 * the portal session is consulted is the details prefill, which uses
 * `patientFetch` directly (see `use-prefill-from-portal-session.ts`).
 *
 * Ported from apps/app's `@/features/booking-forms/api` +
 * `manage-booking.hook`, collapsed into one module because the marketing app
 * has no feature-package layering to mirror.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient } from '@/lib/api-client';

import type {
  AvailableSlotsResponse,
  CancelManagedAppointmentResponse,
  GeneralBookingConfig,
  GeneralBookingResult,
  ManagedAppointment,
  RescheduleManagedAppointmentResponse,
  SubmitGeneralBookingInput,
} from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Build the `?locationSlug=` suffix for a public booking URL.
 *
 * An ABSENT branch must produce a byte-identical URL to the one this app sent
 * before branches existed — not `?locationSlug=` and not `?`. Single-branch
 * orgs are almost all of production and the API's "no slug = the default
 * branch" fallback is what keeps them working, so the absent case has to stay
 * genuinely absent rather than "present and empty".
 */
const locationQuery = (locationSlug?: string) =>
  locationSlug ? `?locationSlug=${encodeURIComponent(locationSlug)}` : '';

export const getGeneralBookingConfigQueryOptions = (
  organizationSlug: string,
  locationSlug?: string
) =>
  queryOptions({
    // The branch is part of the identity of this config: prices, services,
    // practitioners and the address all differ per branch, so Cork must not be
    // served the cached Dublin payload.
    queryKey: ['general-booking', organizationSlug, locationSlug ?? null],
    queryFn: async () =>
      apiClient.get<GeneralBookingConfig>(
        `public/booking/${organizationSlug}${locationQuery(locationSlug)}`
      ),
    enabled: !!organizationSlug,
    staleTime: 5 * 60 * 1000,
  });

export const useGetGeneralBookingConfig = (
  organizationSlug: string,
  locationSlug?: string
) => {
  const query = useQuery(
    getGeneralBookingConfigQueryOptions(organizationSlug, locationSlug)
  );
  return {
    config: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

interface GetGeneralBookingSlotsParams {
  organizationSlug: string;
  serviceId: string;
  /** YYYY-MM-DD. */
  date: string;
  practitionerId?: string;
  /**
   * The branch being booked. Absent = the org's default branch, which is what
   * this endpoint served before branches existed.
   *
   * This is not cosmetic: the API draws the day from THIS branch's opening
   * hours, its bank-holiday exceptions and its shifts. Omitting it on a
   * `/book/l/cork` page offers the customer Dublin's hours.
   */
  locationSlug?: string;
}

export const getGeneralBookingSlotsQueryOptions = ({
  organizationSlug,
  serviceId,
  date,
  practitionerId,
  locationSlug,
}: GetGeneralBookingSlotsParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set('serviceId', serviceId);
  searchParams.set('date', date);
  if (practitionerId) searchParams.set('practitionerId', practitionerId);
  // Appended only when there IS a branch — see `locationQuery` above.
  if (locationSlug) searchParams.set('locationSlug', locationSlug);

  return queryOptions({
    queryKey: [
      'general-booking-slots',
      organizationSlug,
      serviceId,
      date,
      practitionerId,
      locationSlug ?? null,
    ],
    queryFn: async () =>
      apiClient.get<AvailableSlotsResponse>(
        `public/booking/${organizationSlug}/slots?${searchParams.toString()}`
      ),
    enabled: !!organizationSlug && !!serviceId && !!date,
    staleTime: 60 * 1000,
  });
};

export const useGetGeneralBookingSlots = (
  params: GetGeneralBookingSlotsParams
) => {
  const query = useQuery(getGeneralBookingSlotsQueryOptions(params));
  return {
    slotsResponse: query.data ?? null,
    slots: query.data?.slots ?? [],
    byPractitioner: query.data?.byPractitioner ?? undefined,
    isLoading: query.isLoading,
    // A FAILED availability fetch is not an empty day. Callers must render an
    // error, never a calendar that looks bookable and has nothing in it.
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

interface SubmitGeneralBookingParams extends SubmitGeneralBookingInput {
  organizationSlug: string;
}

/**
 * `locationSlug` rides in the BODY here (config and slots take it as a query
 * param) because that is the shape the API's submit schema declares. Callers
 * that have no branch must leave the key off the object entirely rather than
 * sending `undefined` — see the wizard's `handleSubmit`.
 */

export const useSubmitGeneralBooking = (options?: {
  onSuccess?: (result: GeneralBookingResult) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      organizationSlug,
      ...input
    }: SubmitGeneralBookingParams) =>
      apiClient.post<GeneralBookingResult>(
        `public/booking/${organizationSlug}/submit`,
        input
      ),
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

// ---------------------------------------------------------------------------
// Manage booking (the link in every confirmation email)
// ---------------------------------------------------------------------------

/**
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

  return { cancelBooking: mutation.mutate, isCancelling: mutation.isPending };
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
