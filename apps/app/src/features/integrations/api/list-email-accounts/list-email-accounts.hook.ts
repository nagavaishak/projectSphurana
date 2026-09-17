import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listEmailAccountsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListEmailAccountsResponse } from '../../types';

export const listEmailAccountsQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'email', 'accounts'],
    queryFn: () =>
      apiClient.get<ListEmailAccountsResponse>('integrations/email/accounts', {
        schema: listEmailAccountsResponseSchema,
      }),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListEmailAccountsOptions = {
  queryConfig?: QueryConfig<typeof listEmailAccountsQueryOptions>;
};

export const useListEmailAccounts = ({
  queryConfig,
}: UseListEmailAccountsOptions = {}) => {
  const query = useQuery({
    ...listEmailAccountsQueryOptions(),
    ...queryConfig,
  });

  return {
    accounts: query.data?.accounts ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
