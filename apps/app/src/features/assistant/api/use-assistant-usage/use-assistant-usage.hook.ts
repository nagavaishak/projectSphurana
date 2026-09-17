import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface UsageBucket {
  used: number;
  limit: number;
  remaining: number;
}

export interface AssistantUsageResponse {
  planId: string;
  daily: UsageBucket;
  monthly: UsageBucket;
  hasAccess: boolean;
}

export const assistantUsageQueryOptions = () =>
  queryOptions({
    queryKey: ['assistant', 'usage'],
    queryFn: () => apiClient.get<AssistantUsageResponse>('assistant/usage'),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // 60 seconds
  });

export function useAssistantUsage() {
  const query = useQuery(assistantUsageQueryOptions());

  const data = query.data;
  const dailyUsedPercent = data
    ? data.daily.limit > 0
      ? data.daily.used / data.daily.limit
      : 0
    : 0;

  return {
    usage: data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    hasAccess: data?.hasAccess ?? true,
    isNearDailyLimit: dailyUsedPercent >= 0.8,
    isDailyLimitReached: dailyUsedPercent >= 1,
    refetch: query.refetch,
  };
}
