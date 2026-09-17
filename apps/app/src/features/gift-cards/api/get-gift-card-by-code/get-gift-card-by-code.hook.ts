import { apiClient } from '@borradh-workspace/api-client';
import type { GiftCardWithTransactions } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getGiftCardByCodeQueryOptions = (code: string) =>
  queryOptions({
    queryKey: ['gift-cards', 'by-code', code],
    queryFn: () =>
      apiClient.get<GiftCardWithTransactions>(
        `gift-cards/by-code/${encodeURIComponent(code)}`
      ),
    enabled: !!code,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

/** Look up a gift card by its printed code (POS balance check / redemption). */
export const useGetGiftCardByCode = (code: string, enabled = true) => {
  const query = useQuery({
    ...getGiftCardByCodeQueryOptions(code),
    enabled: enabled && !!code,
  });
  return {
    giftCard: query.data ?? null,
    isLoading: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
