import { apiClient } from '@borradh-workspace/api-client';
import type { GiftCardWithTransactions } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getGiftCardQueryOptions = (giftCardId: string) =>
  queryOptions({
    queryKey: ['gift-cards', 'detail', giftCardId],
    queryFn: () =>
      apiClient.get<GiftCardWithTransactions>(`gift-cards/${giftCardId}`),
    enabled: !!giftCardId,
  });

export const useGetGiftCard = (giftCardId: string) => {
  const query = useQuery(getGiftCardQueryOptions(giftCardId));
  return {
    giftCard: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
