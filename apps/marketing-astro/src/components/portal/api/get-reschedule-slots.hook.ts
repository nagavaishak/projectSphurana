'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { AvailableSlotsResponse } from './types';

interface GetRescheduleSlotsParams {
  organizationSlug: string;
  serviceId: string;
  /** YYYY-MM-DD */
  date: string;
  /**
   * The BRANCH the booking being moved is on —
   * `booking.location.slug ?? booking.location.id`. The endpoint resolves
   * either, so a branch with no slug yet is still addressable.
   *
   * Without it this endpoint resolves the clinic's DEFAULT branch, so a Cork
   * patient was offered Dublin's diary while the row stayed on Cork: Cork's
   * room double-booked, Dublin showing a slot it never sold.
   *
   * Undefined is only correct when the clinic has ONE branch (the default IS
   * the booking's branch). The server decides that, not this hook: it reports
   * `canReschedule: false` for any booking whose branch it could not name, so
   * the picker never opens in the ambiguous case.
   */
  locationSlug?: string;
}

/**
 * Available times for a reschedule.
 *
 * Same endpoint the public booking page uses, so the times offered here are
 * exactly the times that page would offer. It goes through `patientFetch`
 * rather than `@/features/booking-forms` for the CSP reason spelled out in
 * get-org-branding.hook.ts: a microsite may only talk to its own origin.
 */
export const getRescheduleSlotsQueryOptions = ({
  organizationSlug,
  serviceId,
  date,
  locationSlug,
}: GetRescheduleSlotsParams) => {
  const search = new URLSearchParams({ serviceId, date });
  if (locationSlug) search.set('locationSlug', locationSlug);
  return queryOptions({
    queryKey: patientPortalKeys.slots(
      organizationSlug,
      serviceId,
      date,
      locationSlug ?? null
    ),
    queryFn: () =>
      patientFetch<AvailableSlotsResponse>(
        `public/booking/${organizationSlug}/slots?${search.toString()}`,
        { organizationSlug, onUnauthorized: 'keep-session' }
      ),
    enabled: !!serviceId && !!date,
    staleTime: 60 * 1000,
  });
};

export const useGetRescheduleSlots = (params: {
  serviceId: string;
  date: string;
  locationSlug?: string;
}) => {
  const { organizationSlug } = usePortal();
  const query = useQuery(
    getRescheduleSlotsQueryOptions({ organizationSlug, ...params })
  );

  return {
    slots: query.data?.slots ?? [],
    isLoading: query.isLoading && !!params.date,
    isError: query.isError,
  };
};
