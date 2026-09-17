import { apiClient } from '@borradh-workspace/api-client';
import { listMessagesResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListMessagesResponse } from '../types';

interface ListMessagesParams {
  limit?: number;
  offset?: number;
}

export const listMessagesQueryOptions = (
  conversationId: string,
  params: ListMessagesParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['conversations', conversationId, 'messages', params],
    queryFn: () =>
      apiClient.get<ListMessagesResponse>(
        `conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
        { schema: listMessagesResponseSchema }
      ),
    enabled: !!conversationId,
    staleTime: 5 * 1000,
    refetchInterval: 3000,
  });
};

export const useListMessages = (
  conversationId: string,
  params: ListMessagesParams = {}
) => {
  const query = useQuery(listMessagesQueryOptions(conversationId, params));
  return {
    messages: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
