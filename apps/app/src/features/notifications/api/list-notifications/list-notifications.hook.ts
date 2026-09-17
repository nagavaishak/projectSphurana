import { apiClient } from '@borradh-workspace/api-client';
import type {
  ListNotificationsParams,
  ListNotificationsResponse,
} from '@borradh-workspace/api-client/types';
import { listNotificationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const listNotificationsQueryOptions = (
  params: ListNotificationsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set('offset', String(params.offset));
  }
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['notifications', 'list', params] as const,
    queryFn: () =>
      apiClient.get<ListNotificationsResponse>(
        `notifications${qs ? `?${qs}` : ''}`,
        { schema: listNotificationsResponseSchema }
      ),
    staleTime: 30 * 1000,
  });
};

export const useListNotifications = (params: ListNotificationsParams = {}) => {
  const query = useQuery(listNotificationsQueryOptions(params));

  return {
    notifications: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
