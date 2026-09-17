import { apiClient } from '@borradh-workspace/api-client';
import { unreadNotificationCountResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface UnreadNotificationCountResponse {
  count: number;
}

export const getUnreadNotificationCountQueryOptions = () =>
  queryOptions({
    queryKey: ['notifications', 'unread-count'] as const,
    queryFn: () =>
      apiClient.get<UnreadNotificationCountResponse>(
        'notifications/unread-count',
        { schema: unreadNotificationCountResponseSchema }
      ),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

export const useGetUnreadNotificationCount = () => {
  const query = useQuery(getUnreadNotificationCountQueryOptions());

  return {
    unreadCount: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
