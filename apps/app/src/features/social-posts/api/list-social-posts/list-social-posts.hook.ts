import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listSocialPostsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  ListSocialPostsFilters,
  ListSocialPostsResponse,
} from '../../types';

export const listSocialPostsQueryOptions = (
  filters?: ListSocialPostsFilters
) => {
  const queryParams = new URLSearchParams();

  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.platform) queryParams.set('platform', filters.platform);
  if (filters?.mediaType) queryParams.set('mediaType', filters.mediaType);
  if (filters?.startDate) queryParams.set('startDate', filters.startDate);
  if (filters?.endDate) queryParams.set('endDate', filters.endDate);
  if (filters?.search) queryParams.set('search', filters.search);
  if (filters?.limit) queryParams.set('limit', filters.limit.toString());
  if (filters?.offset) queryParams.set('offset', filters.offset.toString());

  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: ['social-posts', 'list', filters],
    queryFn: async () => {
      return apiClient.get<ListSocialPostsResponse>(
        `social-posts${queryString ? `?${queryString}` : ''}`,
        { schema: listSocialPostsResponseSchema }
      );
    },
    staleTime: 30 * 1000, // 30 seconds
  });
};

type UseListSocialPostsOptions = {
  filters?: ListSocialPostsFilters;
  queryConfig?: QueryConfig<typeof listSocialPostsQueryOptions>;
};

export const useListSocialPosts = ({
  filters,
  queryConfig,
}: UseListSocialPostsOptions = {}) => {
  const query = useQuery({
    ...listSocialPostsQueryOptions(filters),
    ...queryConfig,
  });

  const items = query.data?.items;
  const posts = useMemo(() => items ?? [], [items]);

  return {
    posts,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
