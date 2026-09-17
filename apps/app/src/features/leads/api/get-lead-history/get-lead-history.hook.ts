import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type { LeadHistoryResponse } from '@borradh-workspace/api-client/types';
import { leadHistoryResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface GetLeadHistoryParams {
  limit?: number;
  offset?: number;
}

/**
 * Query options for getting lead history (executions + activities)
 */
export const getLeadHistoryQueryOptions = (
  leadId: string,
  params: GetLeadHistoryParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['leads', leadId, 'history', params],
    queryFn: async () => {
      // Runtime-validated against the leadHistory projection schema (report mode).
      return apiClient.get<LeadHistoryResponse>(
        `leads/${leadId}/history${qs ? `?${qs}` : ''}`,
        { schema: leadHistoryResponseSchema }
      );
    },
    enabled: !!leadId,
    staleTime: 30 * 1000, // 30 seconds
  });
};

type UseLeadHistoryOptions = {
  leadId: string;
  params?: GetLeadHistoryParams;
  queryConfig?: QueryConfig<typeof getLeadHistoryQueryOptions>;
};

/**
 * Get Lead History Hook
 * Returns a combined timeline of sequence executions and activities
 */
export const useLeadHistory = ({
  leadId,
  params = {},
  queryConfig,
}: UseLeadHistoryOptions) => {
  const query = useQuery({
    ...getLeadHistoryQueryOptions(leadId, params),
    ...queryConfig,
  });

  return {
    history: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
