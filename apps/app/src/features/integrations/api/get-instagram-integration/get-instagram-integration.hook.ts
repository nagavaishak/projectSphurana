import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { getInstagramIntegrationResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GetInstagramIntegrationResponse } from '../../types';

export const getInstagramIntegrationQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'instagram', 'integration'],
    queryFn: () =>
      apiClient.get<GetInstagramIntegrationResponse>(
        'integrations/instagram/integration',
        { schema: getInstagramIntegrationResponseSchema }
      ),
    staleTime: 60 * 1000,
  });
};

type UseGetInstagramIntegrationOptions = {
  queryConfig?: QueryConfig<typeof getInstagramIntegrationQueryOptions>;
};

export const useGetInstagramIntegration = ({
  queryConfig,
}: UseGetInstagramIntegrationOptions = {}) => {
  const query = useQuery({
    ...getInstagramIntegrationQueryOptions(),
    ...queryConfig,
  });

  const integration = query.data?.integration ?? null;

  return {
    integration,
    isConnected: !!integration?.isActive,
    needsReconnect: integration?.tokenStatus === 'needs_reconnect',
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
