import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Resource } from '../types';

export interface ListResourcesParams {
  categoryId?: string;
  locationId?: string;
  /**
   * Include deactivated resources. Defaults to false server-side, which is
   * what every booking surface wants — a deactivated room must not be
   * assignable. The settings list passes `true` so staff can reactivate.
   */
  includeInactive?: boolean;
}

/** Stable empty fallback — see the note on `NO_CATEGORIES`. */
const NO_RESOURCES: Resource[] = [];

export const listResourcesQueryOptions = (params: ListResourcesParams = {}) => {
  const searchParams = new URLSearchParams();
  if (params.categoryId) searchParams.set('categoryId', params.categoryId);
  if (params.locationId) searchParams.set('locationId', params.locationId);
  if (params.includeInactive !== undefined) {
    searchParams.set('includeInactive', String(params.includeInactive));
  }
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: queryKeys.resources.list(params),
    queryFn: () => apiClient.get<Resource[]>(`resources${qs ? `?${qs}` : ''}`),
    staleTime: 5 * 60 * 1000,
  });
};

/** The org's rooms & equipment, optionally scoped to a category or location. */
export const useListResources = (params: ListResourcesParams = {}) => {
  const query = useQuery(listResourcesQueryOptions(params));
  return {
    resources: query.data ?? NO_RESOURCES,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
