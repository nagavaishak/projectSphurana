import { apiClient } from '@borradh-workspace/api-client';
import type { OrganizationServiceCategory } from '@borradh-workspace/api-client/types';
import { listServiceCategoriesResponseSchema } from '@borradh-workspace/contracts';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';

export const listCategoriesQueryOptions = () =>
  queryOptions({
    queryKey: ['service-categories', 'list'],
    queryFn: () =>
      apiClient.get<OrganizationServiceCategory[]>('service-categories', {
        schema: listServiceCategoriesResponseSchema,
      }),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

export const useListCategories = () => {
  const query = useQuery(listCategoriesQueryOptions());
  return {
    categories: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
