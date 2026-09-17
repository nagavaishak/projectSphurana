import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ResourceCategory } from '../types';

/**
 * Stable empty fallback — NOT an inline `?? []`.
 *
 * An inline literal mints a NEW array on every render while `query.data` is
 * undefined (pending / error), which breaks referential equality for any
 * effect or memo that takes the list as a dependency. Same class of bug that
 * put the appointments calendar into an infinite update loop; see the long
 * note on `NO_SHIFT_DAYS` in `features/scheduling/api/list-shifts`.
 */
const NO_CATEGORIES: ResourceCategory[] = [];

export const listResourceCategoriesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.resources.categories(),
    queryFn: () => apiClient.get<ResourceCategory[]>('resources/categories'),
    // Categories are settings data — edited rarely, read on every calendar
    // paint and in every service form. A long stale window keeps the rooms
    // calendar from refetching them on each refocus.
    staleTime: 5 * 60 * 1000,
  });

/** Every resource category for the active org, each with its `resourceCount`. */
export const useListResourceCategories = () => {
  const query = useQuery(listResourceCategoriesQueryOptions());
  return {
    categories: query.data ?? NO_CATEGORIES,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
