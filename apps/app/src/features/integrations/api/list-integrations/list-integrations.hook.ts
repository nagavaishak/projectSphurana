import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listIntegrationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListIntegrationsResponse } from '../../types';

/**
 * Query options for listing integrations
 */
export const listIntegrationsQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations'],
    queryFn: async () => {
      return apiClient.get<ListIntegrationsResponse>('integrations', {
        schema: listIntegrationsResponseSchema,
      });
    },
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListIntegrationsOptions = {
  queryConfig?: QueryConfig<typeof listIntegrationsQueryOptions>;
};

/**
 * List Integrations Hook
 * Returns all integrations for the current organization
 */
export const useListIntegrations = ({
  queryConfig,
}: UseListIntegrationsOptions = {}) => {
  const query = useQuery({
    ...listIntegrationsQueryOptions(),
    ...queryConfig,
  });

  return {
    integrations: query.data?.integrations ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
