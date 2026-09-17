import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type {
  ListLeadsFilters,
  ListLeadsResponse,
} from '@borradh-workspace/api-client/types';
import { listLeadsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Query options for listing leads
 */
export const listLeadsQueryOptions = (filters?: ListLeadsFilters) => {
  const queryParams = new URLSearchParams();

  if (filters?.status) queryParams.set('status', filters.status);
  // Tab filter for the unified Customers surface (leads/contacted/booked; `all`
  // applies no filter server-side). Without this line the tab never reaches the
  // API and every tab shows the same rows.
  if (filters?.stageGroup) queryParams.set('stageGroup', filters.stageGroup);
  if (filters?.source) queryParams.set('source', filters.source);
  if (filters?.sort) queryParams.set('sort', filters.sort);
  if (filters?.sequenceId) queryParams.set('sequenceId', filters.sequenceId);
  if (filters?.assignedToId)
    queryParams.set('assignedToId', filters.assignedToId);
  if (filters?.search) queryParams.set('search', filters.search);
  if (filters?.tags && filters.tags.length > 0)
    queryParams.set('tags', filters.tags.join(','));
  if (filters?.consentEmail !== undefined)
    queryParams.set('consentEmail', String(filters.consentEmail));
  if (filters?.consentSms !== undefined)
    queryParams.set('consentSms', String(filters.consentSms));
  if (filters?.consentVoice !== undefined)
    queryParams.set('consentVoice', String(filters.consentVoice));
  if (filters?.hasEmail !== undefined)
    queryParams.set('hasEmail', String(filters.hasEmail));
  if (filters?.limit) queryParams.set('limit', filters.limit.toString());
  if (filters?.offset) queryParams.set('offset', filters.offset.toString());

  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: ['leads', filters],
    queryFn: async () => {
      // Response is runtime-validated against the contracts schema (report mode
      // by default: a mismatch is logged, not thrown).
      return apiClient.get<ListLeadsResponse>(
        `leads${queryString ? `?${queryString}` : ''}`,
        { schema: listLeadsResponseSchema }
      );
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

type UseListLeadsOptions = {
  filters?: ListLeadsFilters;
  queryConfig?: QueryConfig<typeof listLeadsQueryOptions>;
};

/**
 * List Leads Hook
 * Returns all leads for the current organization with optional filters
 */
export const useListLeads = ({
  filters,
  queryConfig,
}: UseListLeadsOptions = {}) => {
  const query = useQuery({
    ...listLeadsQueryOptions(filters),
    ...queryConfig,
  });

  return {
    leads: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
