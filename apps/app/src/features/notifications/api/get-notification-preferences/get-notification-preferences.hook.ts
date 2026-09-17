import { apiClient } from '@borradh-workspace/api-client';
import type { NotificationPreferences } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

// Re-export the canonical api-client type so existing consumers that import
// `NotificationPreferences` from this feature keep working.
export type { NotificationPreferences };

export const getNotificationPreferencesQueryOptions = () =>
  queryOptions({
    queryKey: ['notification-preferences'] as const,
    queryFn: () =>
      apiClient.get<NotificationPreferences>('notification-preferences'),
    staleTime: 5 * 60 * 1000,
  });

export const useGetNotificationPreferences = () => {
  const query = useQuery(getNotificationPreferencesQueryOptions());

  return {
    preferences: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
