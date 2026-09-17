import { apiClient } from '@borradh-workspace/api-client';
import type { OrgDefaultsResponse } from '@borradh-workspace/api-client/types';
import { orgDefaultsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Query options for `GET /org-defaults`. The response includes the resolved
 * defaults plus an `overrides` map indicating which fields are user-set vs
 * coming from the system fallback.
 */
export const getOrgDefaultsQueryOptions = () =>
  queryOptions({
    queryKey: ['org-defaults'],
    queryFn: () =>
      apiClient.get<OrgDefaultsResponse>('org-defaults', {
        schema: orgDefaultsResponseSchema,
      }),
    staleTime: 60 * 1000, // 1 minute — defaults change infrequently
  });

/**
 * Read the active org's resolved Claire defaults plus the overrides map.
 *
 * Returns `defaults: null` while loading or on error so callers can do a
 * simple `if (!defaults) return <Skeleton />` instead of juggling separate
 * loading + error flags. The flags are still exposed for the form's
 * error-state branch.
 */
export const useGetOrgDefaults = () => {
  const query = useQuery(getOrgDefaultsQueryOptions());
  return {
    defaults: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
