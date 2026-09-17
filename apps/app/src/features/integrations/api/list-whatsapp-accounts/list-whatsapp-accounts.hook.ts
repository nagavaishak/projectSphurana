import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { listWhatsAppAccountsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type {
  ListWhatsAppAccountsResponse,
  WhatsAppAccount,
} from '../../types';

export const listWhatsAppAccountsQueryOptions = () => {
  return queryOptions({
    queryKey: ['integrations', 'whatsapp', 'accounts'],
    queryFn: () =>
      apiClient.get<ListWhatsAppAccountsResponse>(
        'integrations/whatsapp/accounts',
        { schema: listWhatsAppAccountsResponseSchema }
      ),
    staleTime: 60 * 1000, // 1 minute
  });
};

type UseListWhatsAppAccountsOptions = {
  queryConfig?: QueryConfig<typeof listWhatsAppAccountsQueryOptions>;
};

export const useListWhatsAppAccounts = ({
  queryConfig,
}: UseListWhatsAppAccountsOptions = {}) => {
  const query = useQuery({
    ...listWhatsAppAccountsQueryOptions(),
    ...queryConfig,
  });

  return {
    accounts: query.data?.accounts ?? ([] as WhatsAppAccount[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
