import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type { LeadDetail } from '@borradh-workspace/api-client/types';
import { leadDetailSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Query options for getting a single lead
 */
export const getLeadQueryOptions = (leadId: string) => {
  return queryOptions({
    queryKey: ['leads', leadId],
    queryFn: async () => {
      // Runtime-validated against the leadDetail projection schema (report mode).
      return apiClient.get<LeadDetail>(`leads/${leadId}`, {
        schema: leadDetailSchema,
      });
    },
    enabled: !!leadId,
    staleTime: 30 * 1000, // 30 seconds
  });
};

type UseLeadOptions = {
  leadId: string;
  queryConfig?: QueryConfig<typeof getLeadQueryOptions>;
};

/**
 * Get Lead Hook
 * Returns a single lead by ID
 */
export const useLead = ({ leadId, queryConfig }: UseLeadOptions) => {
  const query = useQuery({
    ...getLeadQueryOptions(leadId),
    ...queryConfig,
  });

  return {
    lead: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
