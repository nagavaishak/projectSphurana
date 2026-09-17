import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type ListStripeTaxCodesResponse,
  listStripeTaxCodesResponseSchema,
} from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/** The browser reads Borradh's cached endpoint — never Stripe directly. */
export const listStripeTaxCodesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.integrations.stripeTaxCodes(),
    queryFn: () =>
      apiClient.get<ListStripeTaxCodesResponse>(
        'integrations/stripe/tax-codes',
        { schema: listStripeTaxCodesResponseSchema }
      ),
    staleTime: 60 * 60 * 1000,
  });

export const useListStripeTaxCodes = () => {
  const query = useQuery(listStripeTaxCodesQueryOptions());
  return {
    taxCodes: query.data?.taxCodes ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
