import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type { GetMetaIntegrationResponse } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

type MetaIntegrationRow = NonNullable<
  GetMetaIntegrationResponse['integration']
> & {
  configurationStatus?: 'pending_selection' | 'configured';
  tokenStatus?: 'valid' | 'needs_reconnect';
};

export const getMetaIntegrationQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'meta-ads', 'integration'],
    queryFn: () =>
      apiClient.get<GetMetaIntegrationResponse>(
        'integrations/meta-ads/integration'
      ),
    staleTime: 60 * 1000,
  });
};

type UseGetMetaIntegrationOptions = {
  queryConfig?: QueryConfig<typeof getMetaIntegrationQueryOptions>;
};

export const useGetMetaIntegration = ({
  queryConfig,
}: UseGetMetaIntegrationOptions = {}) => {
  const query = useQuery({
    ...getMetaIntegrationQueryOptions(),
    ...queryConfig,
  });

  const integration = (query.data?.integration ??
    null) as MetaIntegrationRow | null;
  const configurationStatus = integration?.configurationStatus;

  return {
    integration,
    isConnected: configurationStatus === 'configured',
    isPendingConfiguration: configurationStatus === 'pending_selection',
    needsReconnect: integration?.tokenStatus === 'needs_reconnect',
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
