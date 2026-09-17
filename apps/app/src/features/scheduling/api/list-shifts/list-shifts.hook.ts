import { apiClient } from '@borradh-workspace/api-client';
import { listShiftsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ResolvedShiftDay } from '../types';

export interface ListShiftsParams {
  /** ISO datetime string — start of the resolution window. */
  from: string;
  /** ISO datetime string — end of the resolution window. */
  to: string;
  locationId?: string;
  practitionerId?: string;
}

export const listShiftsQueryOptions = (params: ListShiftsParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set('from', params.from);
  searchParams.set('to', params.to);
  if (params.locationId) searchParams.set('locationId', params.locationId);
  if (params.practitionerId) {
    searchParams.set('practitionerId', params.practitionerId);
  }

  return queryOptions({
    queryKey: ['shifts', 'list', params],
    queryFn: () =>
      apiClient.get<ResolvedShiftDay[]>(`shifts?${searchParams.toString()}`, {
        schema: listShiftsResponseSchema,
      }),
    staleTime: 60 * 1000,
    enabled: !!params.from && !!params.to,
  });
};

/**
 * Stable empty fallback — NOT an inline `?? []`.
 *
 * An inline literal mints a NEW array on every render while `query.data` is
 * undefined (pending / disabled / error). `appointments-provider.tsx` feeds
 * `shiftDays` straight into an effect that writes calendar context:
 *
 *   useEffect(() => { setResolvedShifts(shiftDays.map(toCalendarShift)) },
 *             [shiftDays, setResolvedShifts])
 *
 * A fresh `[]` each render ⇒ the dep changes every render ⇒ the effect re-runs
 * ⇒ context state updates ⇒ re-render ⇒ … an infinite update loop. React gives
 * up with error #185 ("Maximum update depth exceeded") and the dashboard's
 * error boundary swallows the whole page: "We could not load the dashboard."
 *
 * It only *reached* the depth limit when the shifts query stayed pending long
 * enough — i.e. when the API was slow — so it read as calendar flakiness under
 * load rather than the deterministic bug it is.
 */
const NO_SHIFT_DAYS: ResolvedShiftDay[] = [];

export const useListShifts = (params: ListShiftsParams) => {
  const query = useQuery(listShiftsQueryOptions(params));
  return {
    shiftDays: query.data ?? NO_SHIFT_DAYS,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
