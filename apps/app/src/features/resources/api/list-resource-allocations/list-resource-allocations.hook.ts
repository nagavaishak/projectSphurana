import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import type { AppointmentResourceAllocation } from '../types';

export interface ResourceAllocationsParams {
  /** ISO datetime string — start of the calendar window. */
  from: string;
  /** ISO datetime string — end of the calendar window. */
  to: string;
  /**
   * Scope the feed to one branch. Absent = every branch.
   *
   * A resource that belongs to no branch is available everywhere, so the server
   * includes it whatever branch is asked for — this narrows the feed, it does
   * not hide shared equipment.
   */
  locationId?: string;
  /**
   * Opt out of fetching while keeping the hook mounted. The create dialog is
   * rendered inside EVERY empty calendar slot (~96 per column per day) and
   * each one derives its own window — fetching for closed dialogs fired one
   * request per slot on every day view. Default true.
   */
  enabled?: boolean;
}

/** Stable empty fallback — see the note on `NO_CATEGORIES`. */
const NO_ALLOCATIONS: AppointmentResourceAllocation[] = [];

export const resourceAllocationsQueryOptions = (
  params: ResourceAllocationsParams
) => {
  const searchParams = new URLSearchParams();
  searchParams.set('from', params.from);
  searchParams.set('to', params.to);
  if (params.locationId) searchParams.set('locationId', params.locationId);

  return queryOptions({
    queryKey: queryKeys.resources.allocations(params),
    queryFn: () =>
      apiClient.get<AppointmentResourceAllocation[]>(
        `resources/allocations?${searchParams.toString()}`
      ),
    enabled: params.enabled !== false && !!params.from && !!params.to,
    staleTime: 60 * 1000,
    // Stepping a day forward keeps the previous day's blocks on screen while
    // the next window loads, instead of blanking the rooms calendar.
    placeholderData: keepPreviousData,
  });
};

/**
 * The resource holds inside a calendar window — one block per room per
 * appointment.
 *
 * `startDate`/`endDate` describe the HOLD, not the appointment: `endDate`
 * already includes `turnaroundMinutes`, which is carried separately so the
 * calendar can hatch the cleanup tail rather than paint it as booked time.
 *
 * This is the cache `useReassignAppointmentResource` patches optimistically.
 */
export const useResourceAllocations = (params: ResourceAllocationsParams) => {
  const query = useQuery(resourceAllocationsQueryOptions(params));
  return {
    allocations: query.data ?? NO_ALLOCATIONS,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
