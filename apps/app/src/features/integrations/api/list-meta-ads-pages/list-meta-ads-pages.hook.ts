import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListMetaAdsPagesResponse } from '../../types';

export const listMetaAdsPagesQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'meta-ads', 'pages'],
    queryFn: () =>
      apiClient.get<ListMetaAdsPagesResponse>('integrations/meta-ads/pages'),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListMetaAdsPagesOptions = {
  queryConfig?: QueryConfig<typeof listMetaAdsPagesQueryOptions>;
};

export const useListMetaAdsPages = ({
  queryConfig,
}: UseListMetaAdsPagesOptions = {}) => {
  const query = useQuery({
    ...listMetaAdsPagesQueryOptions(),
    ...queryConfig,
  });

  return {
    pages: query.data?.pages ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
