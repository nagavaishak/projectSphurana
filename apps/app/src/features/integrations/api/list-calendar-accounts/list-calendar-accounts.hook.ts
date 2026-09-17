import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listCalendarAccountsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type {
  CalendarAccount,
  ListCalendarAccountsResponse,
} from '../../types';

export const listCalendarAccountsQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'calendar', 'accounts'],
    queryFn: () =>
      apiClient.get<ListCalendarAccountsResponse>(
        'integrations/calendar/accounts',
        { schema: listCalendarAccountsResponseSchema }
      ),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListCalendarAccountsOptions = {
  queryConfig?: QueryConfig<typeof listCalendarAccountsQueryOptions>;
};

export const useListCalendarAccounts = ({
  queryConfig,
}: UseListCalendarAccountsOptions = {}) => {
  const query = useQuery({
    ...listCalendarAccountsQueryOptions(),
    ...queryConfig,
  });

  return {
    accounts: query.data?.accounts ?? ([] as CalendarAccount[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
