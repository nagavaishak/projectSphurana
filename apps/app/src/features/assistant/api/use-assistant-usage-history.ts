import { queryOptions, useQuery } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

export interface UsageHistoryDayPoint {
  date: string;
  count: number;
}

export interface UsageHistoryMonthPoint {
  month: string;
  count: number;
}

export interface UsageHistoryToolPoint {
  toolName: string;
  count: number;
}

export interface AssistantUsageHistoryResponse {
  planId: string;
  dailyLimit: number;
  monthlyLimit: number;
  daily: UsageHistoryDayPoint[];
  monthly: UsageHistoryMonthPoint[];
  topTools: UsageHistoryToolPoint[];
}

export interface UseAssistantUsageHistoryParams {
  days?: number;
  monthlyMonths?: number;
}

const buildSearch = (params: UseAssistantUsageHistoryParams) => {
  const sp = new URLSearchParams();
  if (params.days !== undefined) sp.set('days', String(params.days));
  if (params.monthlyMonths !== undefined)
    sp.set('monthlyMonths', String(params.monthlyMonths));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
};

export const assistantUsageHistoryQueryOptions = (
  params: UseAssistantUsageHistoryParams = {}
) =>
  queryOptions({
    queryKey: ['assistant', 'usage', 'history', params] as const,
    queryFn: async (): Promise<AssistantUsageHistoryResponse> => {
      const res = await fetch(
        assistantApiUrl(`usage/history${buildSearch(params)}`),
        assistantRequestInit()
      );
      if (!res.ok) throw new Error('Failed to fetch usage history');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

export function useAssistantUsageHistory(
  params: UseAssistantUsageHistoryParams = {}
) {
  const query = useQuery(assistantUsageHistoryQueryOptions(params));
  return {
    history: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
