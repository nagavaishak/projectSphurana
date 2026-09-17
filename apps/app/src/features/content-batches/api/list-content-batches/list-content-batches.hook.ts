import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listContentBatchesResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  ListContentBatchesFilters,
  ListContentBatchesResponse,
} from '../../types';

export const listContentBatchesQueryOptions = (
  filters?: ListContentBatchesFilters
) => {
  const queryParams = new URLSearchParams();

  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.limit) queryParams.set('limit', filters.limit.toString());
  if (filters?.offset) queryParams.set('offset', filters.offset.toString());

  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: ['content-batches', 'list', filters],
    queryFn: async () => {
      return apiClient.get<ListContentBatchesResponse>(
        `content-batches${queryString ? `?${queryString}` : ''}`,
        { schema: listContentBatchesResponseSchema }
      );
    },
    staleTime: 60 * 1000,
  });
};

type UseListContentBatchesOptions = {
  filters?: ListContentBatchesFilters;
  queryConfig?: QueryConfig<typeof listContentBatchesQueryOptions>;
};

export const useListContentBatches = ({
  filters,
  queryConfig,
}: UseListContentBatchesOptions = {}) => {
  const query = useQuery({
    ...listContentBatchesQueryOptions(filters),
    ...queryConfig,
  });

  const items = query.data?.items;
  const batches = useMemo(() => items ?? [], [items]);

  return {
    batches,
    limit: query.data?.limit ?? 0,
    offset: query.data?.offset ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
