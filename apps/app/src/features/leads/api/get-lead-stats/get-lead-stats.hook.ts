import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type { LeadStats } from '@borradh-workspace/api-client/types';
import { leadStatsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Query options for getting lead statistics
 */
export const getLeadStatsQueryOptions = () => {
  return queryOptions({
    queryKey: ['leads', 'stats'],
    queryFn: async () => {
      // Runtime-validated against the leadStats projection schema (report mode).
      return apiClient.get<LeadStats>('leads/stats', {
        schema: leadStatsSchema,
      });
    },
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseLeadStatsOptions = {
  queryConfig?: QueryConfig<typeof getLeadStatsQueryOptions>;
};

/**
 * Get Lead Stats Hook
 * Returns statistics about leads
 */
export const useLeadStats = ({ queryConfig }: UseLeadStatsOptions = {}) => {
  const query = useQuery({
    ...getLeadStatsQueryOptions(),
    ...queryConfig,
  });

  return {
    stats: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
