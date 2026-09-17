import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type {
  BookingAccount,
  BookingProvider,
  ListBookingAccountsResponse,
} from '../../types';

export const listBookingAccountsQueryOptions = (provider?: BookingProvider) => {
  const queryParams = provider ? `?provider=${provider}` : '';
  return queryOptions({
    queryKey: ['integrations', 'booking', 'accounts', provider].filter(Boolean),
    queryFn: () =>
      apiClient.get<ListBookingAccountsResponse>(
        `integrations/booking/accounts${queryParams}`
      ),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListBookingAccountsOptions = {
  provider?: BookingProvider;
  queryConfig?: QueryConfig<typeof listBookingAccountsQueryOptions>;
};

export const useListBookingAccounts = ({
  provider,
  queryConfig,
}: UseListBookingAccountsOptions = {}) => {
  const query = useQuery({
    ...listBookingAccountsQueryOptions(provider),
    ...queryConfig,
  });

  return {
    accounts: query.data?.accounts ?? ([] as BookingAccount[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
