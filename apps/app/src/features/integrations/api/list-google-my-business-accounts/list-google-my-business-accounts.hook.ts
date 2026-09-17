import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listGoogleMyBusinessAccountsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type {
  GoogleMyBusinessAccount,
  ListGoogleMyBusinessAccountsResponse,
} from '../../types';

export const listGoogleMyBusinessAccountsQueryOptions = () =>
  queryOptions({
    queryKey: ['integrations', 'google-my-business', 'accounts'],
    queryFn: () =>
      apiClient.get<ListGoogleMyBusinessAccountsResponse>(
        'integrations/google-my-business/accounts',
        { schema: listGoogleMyBusinessAccountsResponseSchema }
      ),
    staleTime: 60 * 1000, // 1 minute
  });

type UseListGoogleMyBusinessAccountsOptions = {
  queryConfig?: QueryConfig<typeof listGoogleMyBusinessAccountsQueryOptions>;
};

export const useListGoogleMyBusinessAccounts = ({
  queryConfig,
}: UseListGoogleMyBusinessAccountsOptions = {}) => {
  const query = useQuery({
    ...listGoogleMyBusinessAccountsQueryOptions(),
    ...queryConfig,
  });

  return {
    accounts: query.data?.accounts ?? ([] as GoogleMyBusinessAccount[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
