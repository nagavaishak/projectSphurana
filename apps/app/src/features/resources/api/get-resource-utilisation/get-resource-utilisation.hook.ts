import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import type {
  ResourceUtilisationResponse,
  ResourceUtilisationRow,
} from '../types';

export interface ResourceUtilisationParams {
  /** ISO date (inclusive). */
  from: string;
  /** ISO date (exclusive). */
  to: string;
  locationId?: string;
}

/** Stable empty fallback — see the note on `NO_CATEGORIES`. */
const NO_ROWS: ResourceUtilisationRow[] = [];

export const resourceUtilisationQueryOptions = (
  params: ResourceUtilisationParams
) => {
  const searchParams = new URLSearchParams();
  searchParams.set('from', params.from);
  searchParams.set('to', params.to);
  if (params.locationId) searchParams.set('locationId', params.locationId);

  return queryOptions({
    queryKey: queryKeys.resources.utilisation(params),
    queryFn: () =>
      apiClient.get<ResourceUtilisationResponse>(
        `resources/utilisation?${searchParams.toString()}`
      ),
    enabled: !!params.from && !!params.to,
    // A report over a date range: expensive to compute, and nothing inside the
    // window changes while the user reads it.
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
};

/**
 * The utilisation report — booked vs open minutes and revenue per resource.
 *
 * `utilisation` is 0..1 and is 0 (never NaN) when the resource had no open
 * minutes in the range, so it is safe to format directly.
 */
export const useResourceUtilisation = (params: ResourceUtilisationParams) => {
  const query = useQuery(resourceUtilisationQueryOptions(params));
  return {
    rows: query.data?.rows ?? NO_ROWS,
    from: query.data?.from ?? params.from,
    to: query.data?.to ?? params.to,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
