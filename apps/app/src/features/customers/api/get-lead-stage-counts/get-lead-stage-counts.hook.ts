import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';

/**
 * Response of `GET /leads/stage-counts` (unify-customers PR 1).
 *
 * `stages` counts every lead by its pipeline stage; `tabs` is the same data
 * pre-grouped for the Clients tab strip (`tabs.all` includes `lost`,
 * `tabs.leads = stages.new`, and `tabs.contacted` folds in `qualified`). There
 * is no contracts/api-client type for this endpoint yet, so the shape is
 * declared here.
 */
export interface LeadStageCounts {
  stages: {
    new: number;
    contacted: number;
    qualified: number;
    booked: number;
    lost: number;
  };
  tabs: { all: number; leads: number; contacted: number; booked: number };
}

export const leadStageCountsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.leads.stageCounts(),
    queryFn: () => apiClient.get<LeadStageCounts>('leads/stage-counts'),
    staleTime: 60 * 1000,
  });

/**
 * Per-tab / per-stage lead counts for the Clients tab badges. Invalidated by
 * `useSetLeadStage` and any lead mutation via the shared `['leads']` key.
 */
export const useLeadStageCounts = (
  queryConfig?: QueryConfig<typeof leadStageCountsQueryOptions>
) => {
  const query = useQuery({ ...leadStageCountsQueryOptions(), ...queryConfig });

  return {
    counts: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
